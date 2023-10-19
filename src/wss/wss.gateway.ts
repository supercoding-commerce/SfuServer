import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import * as config from 'config';
import io, { Socket, Server } from 'socket.io';

import * as mediasoup from 'mediasoup';
import { Worker, WorkerSettings } from 'mediasoup/node/lib/Worker';

import { LoggerService } from '../logger/logger.service';

import { IClientQuery, IMsMessage, IWorkerInfo } from './wss.interfaces';
import { WssRoom } from './wss.room';

const appSettings = config.get<IAppSettings>('APP_SETTINGS');
const mediasoupSettings = config.get<IMediasoupSettings>('MEDIASOUP_SETTINGS');

@WebSocketGateway(appSettings.wssPort)
export class WssGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  public server: Server;

  public rooms: Map<string, WssRoom> = new Map();

  public workers: {
    [index: number]: {
      clientsCount: number;
      roomsCount: number;
      pid: number;
      worker: Worker;
    };
  };

  constructor(private readonly logger: LoggerService) {
    this.createWorkers();
  }

  get workersInfo() {
    this.updateWorkerStats();

    return Object.fromEntries(
      Object.entries(this.workers).map((w) => {
        return [
          w[1].pid,
          {
            workerIndex: parseInt(w[0], 10),
            clientsCount: w[1].clientsCount,
            roomsCount: w[1].roomsCount,
          },
        ];
      }),
    ) as { [pid: string]: IWorkerInfo };
  }

  /**
   * 미디어 수프 워커를 만듭니다.
   * @returns {Promise<void>} Promise<void>
   */
  private async createWorkers(): Promise<void> {
    const promises = [];
    for (let i = 0; i < mediasoupSettings.workerPool; i++) {
      promises.push(
        mediasoup.createWorker(mediasoupSettings.worker as WorkerSettings),
      );
    }

    //합산이 아니라, 배열의 요소를 객체로 변환하는데에 reduce 사용
    //따라서, reduce 메서드는 단순히 숫자를 합산하는 것 외에도, 배열의 요소를 다른 형태의 데이터 구조로 변환하는 데 유용하게 사용될 수 있습니다.
    //이러한 유연성 때문에 reduce는 JavaScript에서 배열을 처리하는 데 있어서 매우 강력한 도구 중 하나로 간주됩니다.
    this.workers = (await Promise.all(promises)).reduce(
      (acc, worker, index) => {
        acc[index] = {
          clientsCount: 0,
          roomsCount: 0,
          pid: worker.pid,
          worker,
        };
        console.log(`created worder pid ${worker.pid}`);

        return acc;
      },
      {},
    );
  }

  /**
   * 서버의 사용자 수에 대한 정보를 업데이트합니다.
   * @returns {void} void
   */
  public updateWorkerStats(): void {
    const data: {
      [index: number]: { clientsCount: number; roomsCount: number };
    } = {};

    this.rooms.forEach((room) => {
      if (data[room.workerIndex]) {
        data[room.workerIndex].clientsCount += room.clientsCount;
        data[room.workerIndex].roomsCount += 1;
      } else {
        data[room.workerIndex] = {
          clientsCount: room.clientsCount,
          roomsCount: 1,
        };
      }
    });

    Object.entries(this.workers).forEach(([index, _worker]) => {
      const info = data[index];
      if (info) {
        this.workers[index].clientsCount = info.clientsCount;
        this.workers[index].roomsCount = info.roomsCount;
      } else {
        this.workers[index].clientsCount = 0;
        this.workers[index].roomsCount = 0;
      }
    });
  }

  /**
   * 참가자 수가 가장 적은 워커의 수를 반환합니다.
   * @returns {number} number
   */
  private getOptimalWorkerIndex(): number {
    return parseInt(
      Object.entries(this.workers).reduce((prev, curr) => {
        if (prev[1].clientsCount < curr[1].clientsCount) {
          return prev;
        }
        return curr;
      })[0],
      10,
    );
  }

  private getClientQuery(client: Socket): IClientQuery {
    return client.handshake.query as unknown as IClientQuery;
  }

  //새로운 클라이언트가 웹소켓 서버에 연결될 때 호출됩니다.
  public async handleConnection(client: Socket) {
    try {
      const query = this.getClientQuery(client);

      let room = this.rooms.get(query.session_id);

      if (!room) {
        this.updateWorkerStats();

        const index = this.getOptimalWorkerIndex();

        room = new WssRoom(
          this.workers[index].worker,
          index,
          query.session_id,
          this.logger,
          this.server,
        );

        await room.load();

        this.rooms.set(query.session_id, room);

        this.logger.info(`room ${query.session_id} created`);
      }

      await room.addClient(query, client);

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - handleConnection',
      );
    }
  }

  public async handleDisconnect(client: io.Socket) {
    try {
      const { user_id, session_id } = this.getClientQuery(client);

      const room = this.rooms.get(session_id);

      await room.removeClient(user_id);

      if (!room.clientsCount) {
        room.close();
        this.rooms.delete(session_id);
      }

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - handleDisconnect',
      );
    }
  }

  @SubscribeMessage('mediaRoomClients')
  public async roomClients(client: Socket) {
    try {
      const { session_id } = this.getClientQuery(client);

      const room = this.rooms.get(session_id);

      return {
        clientsIds: room.clientsIds,
        producerAudioIds: room.audioProducerIds,
        producerVideoIds: room.videoProducerIds,
      };
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - roomClients');
    }
  }

  @SubscribeMessage('mediaRoomInfo')
  public async roomInfo(client: Socket) {
    try {
      const { session_id } = this.getClientQuery(client);

      const room = this.rooms.get(session_id);

      return room.stats;
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - roomInfo');
    }
  }

  @SubscribeMessage('media')
  public async media(client: Socket, msg: IMsMessage) {
    try {
      const { user_id, session_id } = this.getClientQuery(client);

      const room = this.rooms.get(session_id);

      return await room.speakMsClient(user_id, msg);
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - media');
    }
  }

  @SubscribeMessage('mediaReconfigure')
  public async roomReconfigure(client: Socket) {
    try {
      const { session_id } = this.getClientQuery(client);

      const room = this.rooms.get(session_id);

      if (room) {
        await this.reConfigureMedia(room);
      }

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - roomReconfigure',
      );
    }
  }

  /**
   *
   * @param {WssRoom} room комната
   * @returns {Promise<void>} Promise<void>
   */
  public async reConfigureMedia(room: WssRoom): Promise<void> {
    try {
      this.updateWorkerStats();

      const index = this.getOptimalWorkerIndex();

      await room.reConfigureMedia(this.workers[index].worker, index);
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - reConfigureMedia',
      );
    }
  }
}
