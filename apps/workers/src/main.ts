import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  process.env.IS_WORKER = 'true';
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  logger.log('Worker processes started');

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      logger.log(`Received ${signal}, shutting down workers...`);
      await app.close();
      process.exit(0);
    });
  }
}

bootstrap();
