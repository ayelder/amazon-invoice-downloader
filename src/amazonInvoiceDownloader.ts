import { Browser, BrowserContext, Page, chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { InvoiceData, InvoiceProcessor, PaymentTransaction } from './InvoiceProcessor';
import { TransactionReportGenerator } from './TransactionReportGenerator';

interface DownloaderConfig {
  email: string;
  password: string;
  year: number;
  downloadPath: string;
}

interface TransactionWithOrder extends PaymentTransaction {
  orderId: string;
  orderType: 'amazon' | 'whole-foods' | 'amazon-fresh';
}

export class AmazonInvoiceDownloader {
  private static instance: AmazonInvoiceDownloader | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private invoiceProcessor: InvoiceProcessor;
  private readonly reportGenerator: TransactionReportGenerator;
  private yearlyTransactions: TransactionWithOrder[] = [];

  private static readonly DELAYS = {
    DEFAULT: {
      MIN: 800,
      MAX: 2000
    },
    PAGE_NAVIGATION: {
      MIN: 2000,
      MAX: 4000
    }
  } as const;

  private constructor(private readonly config: DownloaderConfig) {
    if (!fs.existsSync(config.downloadPath)) {
      fs.mkdirSync(config.downloadPath, { recursive: true });
    }
    this.setupCleanupHandlers();
    this.invoiceProcessor = new InvoiceProcessor();
    this.reportGenerator = new TransactionReportGenerator(
      config.downloadPath,
      config.year
    );
  }

  public static async create(config: DownloaderConfig): Promise<AmazonInvoiceDownloader> {
    if (!AmazonInvoiceDownloader.instance) {
      AmazonInvoiceDownloader.instance = new AmazonInvoiceDownloader(config);
    } else {
      logger.warn('Attempted to create a new instance while one already exists');
    }
    return AmazonInvoiceDownloader.instance;
  }

  private setupCleanupHandlers(): void {
    const cleanup = async (signal: string) => {
      logger.info(`Received ${signal}. Cleaning up...`);
      await this.cleanup(true);
      process.exit(0);
    };

    process.on('SIGINT', () => cleanup('SIGINT'));
    process.on('SIGTERM', () => cleanup('SIGTERM'));
  }

  public static async getInstance(): Promise<AmazonInvoiceDownloader | null> {
    return AmazonInvoiceDownloader.instance;
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting Amazon invoice download process');
      await this.initializeBrowser();
      await this.login();
      await this.navigateToOrders();
      await this.downloadInvoices();
      await this.cleanup(false);
    } catch (error) {
      logger.error('Error during execution:', error);
      logger.info('Keeping browser open for debugging');
      // Keep process alive and browser open
      await new Promise(() => {
        logger.info('Process kept alive for debugging. Press Ctrl+C to exit.');
      });
    }
  }

  private async initializeBrowser(): Promise<void> {
    logger.info('Initializing browser');
    this.browser = await chromium.launch({
      headless: false // Set to true for production
    });
    
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true
    });
    
    this.page = await this.context.newPage();
  }

  private async login(): Promise<void> {
    logger.info('Navigating to Amazon login page');
    const tld = 'com';
    const flexPrefix = 'us';
    await this.page!.goto(`https://www.amazon.${tld}/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.${tld}%2F%3Fref_%3Dnav_signin&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=${flexPrefix}flex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0`);
    
    // Enter email
    logger.info('Entering email');
    await this.page!.fill('#ap_email', this.config.email);
    await this.page!.click('#continue');

    // Enter password and wait for successful login
    logger.info('Entering password');
    await this.page!.fill('#ap_password', this.config.password);
    
    // Click sign in and wait for either success or CAPTCHA
    await Promise.all([
      this.page!.click('#signInSubmit'),
      // Wait for either navigation or CAPTCHA
      Promise.race([
        this.page!.waitForSelector('#nav-orders', { timeout: 5000 }),
        this.page!.waitForSelector('img[alt="captcha" i]', { timeout: 5000 }).catch(() => null)
      ])
    ]);

    // Check for CAPTCHA
    const hasCaptcha = await this.page!.isVisible('img[alt="captcha" i]');
    if (hasCaptcha) {
      logger.warn('CAPTCHA detected! Please solve the CAPTCHA manually.');
      // Wait for successful navigation after CAPTCHA, give sufficient time for the user to solve the CAPTCHA
      await this.page!.waitForSelector('#nav-orders', { timeout: 300000 });
    }

    logger.info('Login completed successfully');
  }

  private async navigateToOrders(): Promise<void> {
    logger.info('Navigating to orders page');
    await this.page!.goto(`https://www.amazon.com/gp/your-account/order-history?timeFilter=year-${this.config.year}`, {
      waitUntil: 'domcontentloaded'
    });
    await this.page!.waitForSelector('.order-card');
    logger.info('Successfully loaded orders page');
  }

  private async hasNextPage(): Promise<boolean> {
    // Check if there's a non-disabled "Next" button
    const nextButton = await this.page!.$('ul.a-pagination li.a-last:not(.a-disabled)');
    return nextButton !== null;
  }

  private async goToNextPage(): Promise<void> {
    logger.info('Moving to next page...');
    
    // Click the next button
    await this.page!.click('ul.a-pagination li.a-last:not(.a-disabled)');
    
    // Wait for the new page to load
    await this.page!.waitForSelector('.order-card', { 
      state: 'visible',
    });

    // Add a random delay to seem more human-like
    const delay = this.getRandomDelay(AmazonInvoiceDownloader.DELAYS.PAGE_NAVIGATION.MIN, 
                                      AmazonInvoiceDownloader.DELAYS.PAGE_NAVIGATION.MAX);
    logger.debug(`Waiting ${delay}ms after page navigation`);
    await this.page!.waitForTimeout(delay);
  }

  /**
   * Generates a random delay to prevent rate limiting and reduce server load.
   * This helps ensure we're being good citizens while scraping.
   */
  private getRandomDelay(min: number = AmazonInvoiceDownloader.DELAYS.DEFAULT.MIN, 
                        max: number = AmazonInvoiceDownloader.DELAYS.DEFAULT.MAX): number {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

  private async downloadInvoices(): Promise<void> {
    logger.info('Starting invoice download process');
    let totalDownloaded = 0;
    let totalSkipped = 0;
    let pageNum = 1;

    // Create year directory if it doesn't exist
    const yearPath = path.join(this.config.downloadPath, this.config.year.toString());
    if (!fs.existsSync(yearPath)) {
      fs.mkdirSync(yearPath, { recursive: true });
    }

    do {
      logger.info(`Processing page ${pageNum}`);
      const orderElements = await this.page!.$$('.order-card');
      logger.info(`Found ${orderElements.length} orders on current page`);

      for (const orderElement of orderElements) {
        try {
          // Find invoice link by class and text content
          const invoiceLink = await orderElement.$('a.a-link-normal:has-text("View Invoice")');
          if (!invoiceLink) continue; // Skip if no invoice available

          // Extract order ID from the order card
          const orderId = await orderElement.$eval(
            'div[class*="order-id"]',
            el => {
              const text = el.textContent || '';
              const match = text.match(/(?:Order|#)\s*([A-Z0-9-]+)/i);
              return match ? match[1] : null;
            }
          );
          if (!orderId) {
            logger.warn('Could not extract order ID, skipping');
            continue;
          }

          // Determine order type for filename
          const isWholeFood = await orderElement.$('img[alt*="Whole Foods"]')
            .then(element => !!element)
            .catch(() => false);
          
          const isAmazonFresh = await orderElement.$('img[alt*="Amazon Fresh"]')
            .then(element => !!element)
            .catch(() => false);

          let orderType = 'amazon';
          if (isWholeFood) orderType = 'whole-foods';
          if (isAmazonFresh) orderType = 'amazon-fresh';

          const expectedFilename = path.join(yearPath, `${orderType}-invoice-${orderId}.pdf`);

          // Process existing invoice or download new one
          if (fs.existsSync(expectedFilename)) {
            logger.info(`Skipping download for existing invoice ${orderId} (${orderType})`);
            totalSkipped++;
          } else {
            logger.info(`Downloading invoice for order ${orderId} (${orderType})`);
            const invoicePage = await this.context!.newPage();
            try {
              const invoiceUrl = await invoiceLink.getAttribute('href');
              await invoicePage.goto(`https://www.amazon.com${invoiceUrl}`);
              
              await invoicePage.pdf({
                path: expectedFilename,
                format: 'A4',
                printBackground: true,
                margin: {
                  top: '20px',
                  right: '20px',
                  bottom: '20px',
                  left: '20px'
                }
              });
              totalDownloaded++;
            } finally {
              await invoicePage.close();
            }

            // Add random delay between downloads
            const delay = this.getRandomDelay();
            logger.debug(`Waiting ${delay}ms before next order`);
            await this.page!.waitForTimeout(delay);
          }

          // Process the invoice data for the report
          logger.info(`Processing invoice data for order ${orderId} (${orderType})`);
          const data = await this.invoiceProcessor.extractInvoiceData(expectedFilename);
          this.addTransactionsFromInvoice(data);

        } catch (error) {
          logger.error(`Error processing invoice:`, error);
        }
      }

      if (await this.hasNextPage()) {
        await this.goToNextPage();
        pageNum++;
      }
    } while (await this.hasNextPage());

    // Generate the yearly transaction report
    await this.generateTransactionReport();
    
    logger.info(
      `Process completed. Downloaded ${totalDownloaded} new invoices, ` +
      `skipped ${totalSkipped} existing invoices across ${pageNum - 1} pages. ` +
      `Found ${this.yearlyTransactions.length} total transactions.`
    );
  }

  public async cleanup(force: boolean = false): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.context = null;
        this.page = null;
      }
      if (force) {
        AmazonInvoiceDownloader.instance = null;
      }
      logger.info('Cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }

  private addTransactionsFromInvoice(data: InvoiceData): void {
    const transactionsWithOrder = data.payments.map(payment => ({
      ...payment,
      orderId: data.orderId,
      orderType: data.orderType
    }));
    this.yearlyTransactions.push(...transactionsWithOrder);
  }

  private async generateTransactionReport(): Promise<void> {
    await this.reportGenerator.generateReport(this.yearlyTransactions);
  }
} 