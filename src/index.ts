import { AmazonInvoiceDownloader } from './amazonInvoiceDownloader';
import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .options({
      email: {
        type: 'string',
        demandOption: true,
        describe: 'Amazon account email'
      },
      password: {
        type: 'string',
        demandOption: true,
        describe: 'Amazon account password'
      },
      year: {
        type: 'number',
        default: new Date().getFullYear(),
        describe: 'Year to download invoices for'
      },
      downloadPath: {
        type: 'string',
        default: path.join(__dirname, '../downloads'),
        describe: 'Path to download invoices to'
      }
    })
    .usage('Usage: $0 --email <email> --password <password> [--year <year>] [--downloadPath <path>]')
    .example('$0 --email user@example.com --password mypass --year 2022', 'Download invoices for 2022')
    .strict()
    .parse();

  try {
    const downloader = await AmazonInvoiceDownloader.create({
      email: argv.email,
      password: argv.password,
      year: argv.year,
      downloadPath: argv.downloadPath
    });

    await downloader.start();
  } catch (error) {
    console.error('Failed to download invoices:', error);
    
    // Ensure cleanup happens even on error
    const instance = await AmazonInvoiceDownloader.getInstance();
    if (instance) {
      await instance.cleanup(true);
    }
    
    process.exit(1);
  }
}

// Ensure the process doesn't hang
process.on('unhandledRejection', async (error) => {
  console.error('Unhandled rejection:', error);
  const instance = await AmazonInvoiceDownloader.getInstance();
  if (instance) {
    await instance.cleanup(true);
  }
  process.exit(1);
});

main(); 