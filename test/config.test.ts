import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/domain';

test('database TLS turns on for Neon or sslmode=require URLs, and stays off for local/internal ones', () => {
  const ssl = (url: string, flag?: string) => loadConfig({ DATABASE_URL: url, ...(flag ? { DATABASE_SSL: flag } : {}) }).databaseSsl;
  assert.equal(ssl('postgresql://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'), true);
  assert.equal(ssl('postgresql://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb'), true);
  assert.equal(ssl('postgres://u:p@db.example.com:5432/pqrsd?sslmode=verify-full'), true);
  assert.equal(ssl('postgres://pqrsd:pqrsd@db:5432/pqrsd'), false);
  assert.equal(ssl('postgres://pqrsd:pqrsd@localhost:5432/pqrsd?sslmode=disable'), false);
  assert.equal(ssl('postgres://u:p@host/db', 'true'), true);
});
