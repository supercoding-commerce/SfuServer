import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import * as express from 'express';
import { ExtendedIoAdapter } from './ExtendedIoAdapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  );
  // app.useWebSocketAdapter(new IoAdapter(app));
  app.useWebSocketAdapter(new ExtendedIoAdapter(app));

  app.use('/', express.static(join(__dirname, '../public')));

  await app.listen(3000);
}
bootstrap();
