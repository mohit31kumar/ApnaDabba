import dotenv from 'dotenv';
dotenv.config();

const getEnvVar = (name: string, fallback?: string): string => {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

export const env = {
  PORT: parseInt(getEnvVar('PORT', '5000'), 10),
  JWT_SECRET: getEnvVar('JWT_SECRET'),
  DATABASE_URL: getEnvVar('DATABASE_URL'),
  NODE_ENV: getEnvVar('NODE_ENV', 'development'),
};

