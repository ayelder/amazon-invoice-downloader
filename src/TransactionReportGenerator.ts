import * as fs from 'fs';
import * as path from 'path';
import { PaymentTransaction } from './InvoiceProcessor';
import { logger } from './logger';

interface TransactionWithOrder extends PaymentTransaction {
  orderId: string;
  orderType: 'amazon' | 'whole-foods' | 'amazon-fresh';
}

export class TransactionReportGenerator {
  constructor(
    private readonly outputPath: string,
    private readonly year: number
  ) {}

  public async generateReport(transactions: TransactionWithOrder[]): Promise<void> {
    if (transactions.length === 0) {
      logger.warn('No transactions to report');
      return;
    }

    const reportPath = path.join(
      this.outputPath,
      this.year.toString(),
      `transactions-${this.year}.csv`
    );

    try {
      // Create all necessary directories
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });

      // Sort transactions by date
      const sortedTransactions = transactions.sort(
        (a, b) => a.date.getTime() - b.date.getTime()
      );

      // Generate CSV content
      const csvContent = [
        // CSV Header
        ['Date', 'Amount', 'Card Type', 'Last 4 Digits', 'Order ID', 'Order Type'].join(','),
        // CSV Data
        ...sortedTransactions.map(t => [
          t.date.toISOString().split('T')[0],  // YYYY-MM-DD
          t.amount.toFixed(2),
          t.cardType,
          t.lastFourDigits,
          t.orderId,
          t.orderType
        ].join(','))
      ].join('\n');

      // Write to file
      fs.writeFileSync(reportPath, csvContent, 'utf8');
      
      logger.info(`Generated transaction report: ${reportPath}`);
    } catch (error) {
      logger.error('Error generating transaction report:', error);
      const newError = new Error('Failed to generate transaction report');
      newError.cause = error;
      throw newError;
    }
  }
} 