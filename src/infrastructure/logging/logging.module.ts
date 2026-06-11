import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', 'debug'),
          transport:
            config.get('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
              : undefined,
          autoLogging: false,
        },
      }),
    }),
  ],
})
export class LoggingModule {}
