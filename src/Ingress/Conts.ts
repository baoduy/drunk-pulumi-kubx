import { organization } from '@drunk-pulumi/azure/Common/StackEnv';

export const defaultResponseHeaders = {
  server: organization,
  'X-Powered-By': organization,
  'X-AspNet-Version': organization,
  'Strict-Transport-Security': 'max-age=86400; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'X-Frame-Options': `SAMEORIGIN`,
  'Content-Security-Policy': `default-src 'self' data: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'`,
  'X-Content-Type-Options': 'nosniff',
  'Expect-Ct': 'max-age=604800,enforce',
  'Cache-Control': 'max-age=10', //10 second only
};

export const corsDefaultHeaders =
  'DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization';
