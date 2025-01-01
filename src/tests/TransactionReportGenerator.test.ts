import { TransactionReportGenerator } from '../TransactionReportGenerator';
import * as fs from 'fs';
import * as path from 'path';

describe('TransactionReportGenerator', () => {
  const testOutputDir = path.join(__dirname, 'test-output');
  const testYear = 2024;
  let generator: TransactionReportGenerator;

  beforeEach(() => {
    generator = new TransactionReportGenerator(testOutputDir, testYear);
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }
  });

  afterEach(() => {
    fs.rmSync(testOutputDir, { recursive: true, force: true });
  });

  test('generates report with sorted transactions', async () => {
    const transactions = [
      {
        date: new Date('2024-03-15'),
        amount: 50.00,
        cardType: 'Visa',
        lastFourDigits: '1234',
        orderId: '123-456',
        orderType: 'amazon' as const
      },
      {
        date: new Date('2024-03-14'),
        amount: 25.50,
        cardType: 'Mastercard',
        lastFourDigits: '5678',
        orderId: '789-012',
        orderType: 'whole-foods' as const
      }
    ];

    await generator.generateReport(transactions);

    const reportPath = path.join(testOutputDir, '2024', 'transactions-2024.csv');
    expect(fs.existsSync(reportPath)).toBe(true);

    const content = fs.readFileSync(reportPath, 'utf8');
    const lines = content.split('\n');
    
    // Check header
    expect(lines[0]).toBe('Date,Amount,Card Type,Last 4 Digits,Order ID,Order Type');
    
    // Check data is sorted by date
    expect(lines[1]).toContain('2024-03-14');
    expect(lines[2]).toContain('2024-03-15');
  });

  test('handles empty transactions', async () => {
    await generator.generateReport([]);
    
    const reportPath = path.join(testOutputDir, '2024', 'transactions-2024.csv');
    expect(fs.existsSync(reportPath)).toBe(false);
  });
}); 