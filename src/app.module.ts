import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { CorsMiddleware } from './middlewares/cors.middleware';
import { LoggerMiddleware } from './middlewares/logger.middleware';
import { LoggerModule } from './logger/logger.module';
import { WssModule } from './wss/wss.module';

@Module({
  imports: [LoggerModule, WssModule],
  providers: [],
  controllers: [],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void | MiddlewareConsumer {
    consumer.apply(LoggerMiddleware, CorsMiddleware).forRoutes('*');
  }
}
