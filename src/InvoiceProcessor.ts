import * as fs from 'fs';
import * as path from 'path';
import pdf from 'pdf-parse';
import { logger } from './logger';

export interface PaymentTransaction {
  date: Date;
  amount: number;
  cardType: string;  // 'Visa', 'Discover', etc.
  lastFourDigits: string;
}

export interface InvoiceData {
  orderId: string;
  orderType: 'amazon' | 'whole-foods' | 'amazon-fresh';
  orderDate: Date;
  total: number;
  payments: PaymentTransaction[];
}

export class InvoiceProcessor {
  /**
   * Extracts payment transaction data from an invoice PDF file
   */
  public async extractInvoiceData(pdfPath: string): Promise<InvoiceData> {
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      const data = await pdf(dataBuffer);
      
      // Get the text content
      const text = data.text;
      console.log('PDF Text:', text); // Temporary debug logging
      
      // Extract order info first
      const orderId = this.extractOrderId(text);
      const orderType = this.extractOrderTypeFromFilename(pdfPath);
      const orderDate = this.extractOrderDate(text);
      
      // Extract total
      const total = this.extractTotal(text);
      
      // If total is 0, return early with no payments
      if (total === 0) {
        logger.info(`Invoice ${orderId} has zero total, skipping payment extraction`);
        return {
          orderId,
          orderType,
          orderDate,
          total: 0,
          payments: []
        };
      }
      
      // Extract payment transactions
      const payments = this.extractPayments(text);

      return {
        orderId,
        orderType,
        orderDate,
        total,
        payments
      };
    } catch (error) {
      logger.error(`Error extracting data from invoice ${pdfPath}:`, error);
      throw error;
    }
  }

  private extractOrderId(text: string): string {
    const orderIdMatch = text.match(/Amazon\.com order number:\s*(\d{3}-\d{7}-\d{7})/i);
    if (!orderIdMatch) {
      throw new Error('Order ID not found in invoice');
    }
    return orderIdMatch[1];
  }

  private extractOrderTypeFromFilename(pdfPath: string): 'amazon' | 'whole-foods' | 'amazon-fresh' {
    const filename = path.basename(pdfPath).toLowerCase();
    if (filename.startsWith('whole-foods')) return 'whole-foods';
    if (filename.startsWith('amazon-fresh')) return 'amazon-fresh';
    return 'amazon';
  }

  private extractOrderDate(text: string): Date {
    const dateMatch = text.match(/Order Placed:\s*([A-Za-z]+ \d{1,2}, \d{4})/);
    if (!dateMatch) {
      throw new Error('Order date not found in invoice');
    }
    return new Date(dateMatch[1]);
  }

  private extractTotal(text: string): number {
    const totalMatch = text.match(/Grand Total:\s*\$?([\d,]+\.\d{2})/);
    if (!totalMatch) {
      logger.warn('Grand total not found in invoice');
      return 0;
    }
    return parseFloat(totalMatch[1].replace(',', ''));
  }

  private extractPayments(text: string): PaymentTransaction[] {
    const payments: PaymentTransaction[] = [];
    
    // Look for the Credit Card Transactions section
    const headerMatch = text.match(/Credit Card transactions/);
    if (!headerMatch) {
      return []; // No credit card transactions found
    }
    
    // Match each payment transaction after the header
    const transactionPattern = /([A-Za-z]+) ending in (\d{4}):\s*([A-Za-z]+ \d{1,2}, \d{4}):\$(\d+\.\d{2})/g;
    
    let match;
    while ((match = transactionPattern.exec(text)) !== null) {
      payments.push({
        date: new Date(match[3]),
        amount: parseFloat(match[4]),
        cardType: match[1],
        lastFourDigits: match[2]
      });
    }

    return payments;
  }
} 