import { Browser, BrowserContext, Page, chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

interface DownloaderConfig {
  email: string;
  password: string;
  year: number;
  downloadPath: string;
}

export class AmazonInvoiceDownloader {
  private static instance: AmazonInvoiceDownloader | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

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
      logger.info('Keeping browser open due to error');
      throw error;
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
        this.page!.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        this.page!.waitForSelector('#auth-captcha-image', { timeout: 5000 }).catch(() => null)
      ])
    ]);

    // Check for CAPTCHA
    const hasCaptcha = await this.page!.isVisible('#auth-captcha-image');
    if (hasCaptcha) {
      logger.warn('CAPTCHA detected! Please solve the CAPTCHA manually.');
      // Wait for successful navigation after CAPTCHA
      await Promise.race([
        // Wait for successful navigation to Amazon home
        this.page!.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        // Or wait for nav menu to appear
        this.page!.waitForSelector('#nav-belt', { timeout: 60000 })
      ]);
    }

    // Verify successful login
    const isLoggedIn = await this.page!.isVisible('#nav-link-accountList');
    if (!isLoggedIn) {
      throw new Error('Login failed - unable to verify successful login');
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
    let totalProcessed = 0;
    let totalSkipped = 0;
    let pageNum = 1;

    // Create year subfolder
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
          // Extract order ID from the order card
          const orderId = await orderElement.$eval(
            'div[class*="order-id"]',
            el => {
              const text = el.textContent || '';
              const match = text.match(/(?:Order|#)\s*([A-Z0-9-]+)/i);
              if (!match) {
                logger.warn(`Found order ID element but couldn't parse ID from text: "${text}"`);
                return `unknown-${Date.now()}`;
              }
              return match[1];
            }
          ).catch(() => {
            logger.warn('No order ID element found in order card');
            return `unknown-${Date.now()}`;
          });

          // Check if this is a Whole Foods or Amazon Fresh order
          const isWholeFood = await orderElement.$('img[alt*="Whole Foods"]')
            .then(element => !!element)
            .catch(() => false);
          
          const isAmazonFresh = await orderElement.$('img[alt*="Amazon Fresh"]')
            .then(element => !!element)
            .catch(() => false);

          // Determine order type for filename
          let orderType = 'amazon';
          if (isWholeFood) orderType = 'whole-foods';
          if (isAmazonFresh) orderType = 'amazon-fresh';

          // Check if invoice already exists
          const expectedFilename = path.join(
            yearPath,
            `${orderType}-invoice-${orderId}.pdf`
          );
          
          if (fs.existsSync(expectedFilename)) {
            logger.info(`Skipping existing invoice for order ${orderId}`);
            totalSkipped++;
            continue;
          }

          // Find invoice link by class and text content
          const invoiceLink = await orderElement.$('a.a-link-normal:has-text("View Invoice")');
          if (invoiceLink) {
            logger.info(`Processing ${orderType} invoice for order ${orderId}`);
            
            // Get the href attribute from the invoice link
            const invoiceUrl = await invoiceLink.getAttribute('href');
            if (!invoiceUrl) {
              throw new Error('Invoice URL not found');
            }

            // Create a new page for the invoice
            const invoicePage = await this.context!.newPage();
            try {
              // Navigate to invoice URL and wait for content to load
              await invoicePage.goto(`https://www.amazon.com${invoiceUrl}`, {
                waitUntil: 'domcontentloaded'
              });

              // Save the page as PDF
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

              logger.info(`Successfully saved ${orderType} invoice for order ${orderId}`);
            } finally {
              // Always close the invoice page
              await invoicePage.close();
            }
            
            totalProcessed++;
          }

          // Add random delay between orders
          const delay = this.getRandomDelay();
          logger.debug(`Waiting ${delay}ms before next order`);
          await this.page!.waitForTimeout(delay);

        } catch (error) {
          logger.error('Error downloading invoice:', error);
        }
      }

      // Check and handle pagination
      if (await this.hasNextPage()) {
        await this.goToNextPage();
        pageNum++;
      } else {
        break;
      }

    } while (true);
    
    logger.info(
      `Invoice download process completed. ` +
      `Processed ${totalProcessed} orders, skipped ${totalSkipped} existing invoices ` +
      `across ${pageNum} pages.`
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
} 