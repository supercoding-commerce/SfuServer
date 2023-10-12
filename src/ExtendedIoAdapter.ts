import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

export class ExtendedIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions): any {
    options = {
      ...options,
      cors: {
        origin: '*', // 모든 출처 허용
        methods: ['GET', 'POST'], // 허용되는 메서드
        // 필요한 경우 다른 CORS 옵션 추가
      },
    };
    return super.createIOServer(port, options);
  }
}
