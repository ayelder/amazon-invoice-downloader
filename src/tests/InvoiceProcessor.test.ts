import { InvoiceProcessor } from '../InvoiceProcessor';
import * as path from 'path';

describe('InvoiceProcessor', () => {
  let processor: InvoiceProcessor;

  beforeEach(() => {
    processor = new InvoiceProcessor();
  });

  test('processes a single payment invoice', async () => {
    const result = await processor.extractInvoiceData(
      path.join(__dirname, 'fixtures/amazon-invoice-111-0496459-8356251.pdf')
    );

    // Log the full text content for debugging
    console.log('PDF Text Content:', result);

    expect(result).toMatchObject({
      orderId: '111-0496459-8356251',
      orderType: 'amazon',
      orderDate: expect.any(Date),
      total: expect.any(Number),
      payments: expect.arrayContaining([
        expect.objectContaining({
          date: expect.any(Date),
          amount: expect.any(Number),
          cardType: expect.stringMatching(/Visa|Mastercard|Discover|American Express/),
          lastFourDigits: expect.stringMatching(/^\d{4}$/)
        })
      ])
    });
  });

  test('processes a split payment invoice', async () => {
    const result = await processor.extractInvoiceData(
      path.join(__dirname, 'fixtures/whole-foods-invoice-111-6496051-0445818.pdf')
    );

    expect(result.payments.length).toBeGreaterThan(1);
    expect(result.payments.reduce((sum, p) => sum + p.amount, 0))
      .toBeCloseTo(result.total, 2);
  });

  test('handles zero total invoice correctly', async () => {
    const result = await processor.extractInvoiceData(
      path.join(__dirname, 'fixtures/amazon-invoice-111-0129868-1344238.pdf')
    );

    expect(result).toMatchObject({
      orderId: '111-0129868-1344238',
      orderType: 'amazon',
      orderDate: expect.any(Date),
      total: 0,
      payments: []
    });
  });
});