# Amazon Invoice Downloader 📄

[![Node.js Version](https://img.shields.io/badge/node-%E2%89%A514-green](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue.svg)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-1.42.1-brightgreen.svg)](https://playwright.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

An automated tool to bulk download Amazon order invoices for specified years.

## ✨ Features

- Automated login to Amazon account
- Bulk download of invoices for a specified year
- Configurable download location
- Command-line interface with flexible options

## 🔧 Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- System dependencies for Playwright (browser automation)

## 📦 Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd amazon-invoice-downloader
```

2. Install dependencies:

```bash
npm install
```

3. Install browser dependencies:

```bash
npx playwright install-deps
```

## Usage

Basic usage:

```bash
npm start -- --email your@email.com --password yourpassword
```

All available options:

```bash
npm start -- --help
```

### Command Line Options

- `--email`: Amazon account email (required)
- `--password`: Amazon account password (required)
- `--year`: Year to download invoices for (default: current year)
- `--downloadPath`: Custom path to save invoices (default: ./downloads)

### Examples

Download current year's invoices:

```bash
npm start -- --email user@example.com --password mypassword
```

Download invoices for a specific year:

```bash
npm start -- --email user@example.com --password mypassword --year 2022
```

Download to a custom location:

```bash
npm start -- --email user@example.com --password mypassword --downloadPath /path/to/invoices
```

## 🔒 Security Notes

- Never commit your Amazon credentials to version control
- Consider using environment variables for sensitive information
- The tool runs a real browser instance, ensure you're in a secure environment

## 🛠️ Development

1. Build the project:

```bash
npm run build
```

2. Run tests:

```bash
npm test
```

## Author

👤 **Andrew Yelder**
* GitHub: [@ayelder](https://github.com/ayelder)
* LinkedIn: [@andrewyelder](https://linkedin.com/in/andrewyelder) 

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 

## 💡 Inspiration

This project was inspired by:
- [docudigger](https://github.com/Disane87/docudigger)