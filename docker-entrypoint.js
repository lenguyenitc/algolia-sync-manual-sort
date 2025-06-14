#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const env = { 
  ...process.env,
  HOST: '0.0.0.0',
  PORT: process.env.PORT || '3000',
  SHOPIFY_API_URL: process.env.SHOPIFY_API_URL || 'https://shopify.com',
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || '2023-10'
};

// Create .env file with necessary environment variables
const envContent = `
HOST=${process.env.HOST || '0.0.0.0'}
PORT=${process.env.PORT || '3000'}
SHOPIFY_API_URL=${process.env.SHOPIFY_API_URL || 'https://shopify.com'}
SHOPIFY_API_VERSION=${process.env.SHOPIFY_API_VERSION || '2024-01'}
SHOPIFY_API_KEY=${process.env.SHOPIFY_API_KEY}
SHOPIFY_API_SECRET=${process.env.SHOPIFY_API_SECRET}
SHOPIFY_APP_URL=${process.env.SHOPIFY_APP_URL}
DATABASE_URL=${process.env.DATABASE_URL || 'file:./prisma/dev.db'}
NODE_ENV=${process.env.NODE_ENV || 'production'}
SCOPES=${process.env.SCOPES || 'write_products,read_products,write_script_tags,read_script_tags'}
`;

fs.writeFileSync('/app/.env', envContent.trim());
console.log('Created .env file with environment variables');

if (process.argv.slice(-3).join(' ') === 'npm run start') {
  const target = '/data/dev.sqlite';
  const source = path.resolve('/app/prisma/dev.sqlite');

  if (!fs.existsSync('/data')) {
    console.error('Volume /data does not exist');
    throw new Error('/data volume missing');
  }

  try {
    if (fs.existsSync(source)) {
      fs.unlinkSync(source);
      console.log('Removed existing file or symlink at', source);
    }
    fs.symlinkSync(target, source);
    console.log('Symlink created:', source, '->', target);
  } catch (err) {
    console.error('Failed to create symlink:', err);
    throw err;
  }

  const newDb = !fs.existsSync(target);
  if (newDb && process.env.BUCKET_NAME) {
    try {
      console.log('Running litestream restore');
      await exec(`litestream restore -config litestream.yml -if-replica-exists ${target}`);
      console.log('Litestream restore completed');
    } catch (err) {
      console.warn('Litestream restore failed, creating empty database:', err.message);
    }
  }

  if (!fs.existsSync(target)) {
    console.log('Creating empty database at', target);
    fs.writeFileSync(target, '');
  }

  console.log('Running prisma migrate deploy');
  await exec('npx prisma migrate deploy');
  console.log('Prisma migrate deploy completed');
}

// Set DATABASE_URL if not already set
if (!env.DATABASE_URL) {
  env.DATABASE_URL = 'file:/data/dev.sqlite';
}

if (process.env.BUCKET_NAME) {
  console.log('Running litestream replicate');
  await exec(`litestream replicate -config litestream.yml -exec ${JSON.stringify(process.argv.slice(2).join(' '))}`);
} else {
  console.log('Running command without litestream');
  await exec(process.argv.slice(2).join(' '));
}

function exec(command) {
  console.log('Executing command:', command);
  const child = spawn(command, { shell: true, stdio: 'inherit', env });
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      console.log(`Command "${command}" exited with code ${code}`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} failed rc=${code}`));
      }
    });
  });
}