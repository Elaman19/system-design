import { Params } from 'nestjs-pino';

export function loggerConfig(): Params {
  const isDevelopment = process.env.NODE_ENV === 'development';

  return {
    pinoHttp: {
      level: isDevelopment ? 'debug' : 'info',
      transport: isDevelopment
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
    },
  };
}
