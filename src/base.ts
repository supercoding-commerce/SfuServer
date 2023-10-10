// import {
//   MessageBody,
//   SubscribeMessage,
//   WebSocketGateway,
//   WebSocketServer,
//   OnGatewayInit,
//   OnGatewayConnection,
//   OnGatewayDisconnect,
//   ConnectedSocket,
// } from '@nestjs/websockets';
// import { Logger } from '@nestjs/common';
// import io, { Socket, Server } from 'socket.io';
// import * as mediasoup from 'mediasoup';
// import { WorkerSettings } from 'mediasoup/node/lib/types';
// import { Worker } from 'mediasoup/node/lib/types';

// import {
//   IPeerConnection,
//   IProducerConnectorTransport,
//   IPeerTransport,
//   IProduceTrack,
//   IRoomMessageWrapper,
//   IClientProfile,
//   IConsumePeerTransport,
// } from './wss/wss.interfaces';
// import { throwRoomNotFound } from './exceptions/errors';
// import { IRoom } from './wss/wss.interfaces';

// @WebSocketGateway()
// export class BaseGateway<T extends IRoom>
//   implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
// {
//   @WebSocketServer()
//   protected server: Server;

//   // This stores active rooms by their name.
//   protected rooms: Map<string, T> = new Map();

//   private baseLogger: Logger = new Logger('BaseGateway');

//   //This stores the mediasoup workers, which are processes responsible for handling media.
//   protected workers: {
//     [index: number]: {
//       clientsCount: number;
//       roomsCount: number;
//       pid: number;
//       worker: Worker;
//     };
//   };

//   constructor(mediasoupSettings: IMediasoupSettings, private roomType) {
//     this.baseLogger.debug('mediasoupSettings', mediasoupSettings);

//     this.createWorkers(mediasoupSettings);
//   }

//   //Creates a number of mediasoup worker processes as specified in the provided settings.
//   private async createWorkers(
//     mediasoupSettings: IMediasoupSettings,
//   ): Promise<void> {
//     const promises = [];
//     for (let i = 0; i < mediasoupSettings.workerPool; i++) {
//       promises.push(
//         mediasoup.createWorker(mediasoupSettings.worker as WorkerSettings),
//       );
//     }

//     this.workers = (await Promise.all(promises)).reduce(
//       (acc, worker, index) => {
//         acc[index] = {
//           clientsCount: 0,
//           roomsCount: 0,
//           pid: worker.pid,
//           worker: worker,
//         };

//         return acc;
//       },
//       {},
//     );
//   }

//   // private getClientQuery(client: io.Socket): IClientQuery {
//   //   return client.handshake.query as unknown as IClientQuery;
//   // }

//   //Finds and returns the index of the worker with the least clients, ensuring load balancing across workers.
//   protected getOptimalWorkerIndex(): number {
//     return parseInt(
//       Object.entries(this.workers).reduce((prev, curr) => {
//         if (prev[1].clientsCount < curr[1].clientsCount) {
//           return prev;
//         }
//         return curr;
//       })[0],
//       10,
//     );
//   }

//   //Checks if a room exists for a given peerConnection. If it doesn't, it creates one.
//   protected async loadRoom(
//     peerConnection: IPeerConnection,
//     socket: io.Socket,
//   ): Promise<boolean> {
//     try {
//       const { peerId, room: roomName, userProfile } = peerConnection;
//       this.baseLogger.debug('peerConnection', JSON.stringify(peerConnection));
//       let room = this.rooms.get(roomName) as T;
//       this.baseLogger.log('Checking room status');
//       this.baseLogger.log('isLoaded', Boolean(room));
//       if (!room) {
//         const index = this.getOptimalWorkerIndex();
//         room = new this.roomType(
//           this.workers[index].worker,
//           index,
//           roomName,
//           this.server,
//         );

//         await room.load();

//         room.setHost({ io: socket, id: peerId, userProfile, media: {} });
//         this.rooms.set(roomName, room);

//         this.baseLogger.log(`room ${roomName} created`);
//       }

//       socket.on('disconnect', (u) => {
//         this.baseLogger.log('user disconnected', u);
//         room.leave(peerId);
//       });

//       await room.addClient(peerId, socket, userProfile);
//       return true;
//     } catch (error) {
//       this.baseLogger.error(
//         error.message,
//         error.stack,
//         'BaseGateway - handleConnection',
//       );
//     }
//   }

//   @SubscribeMessage('joinRoom')
//   async joinRoom(
//     @MessageBody() data: IPeerConnection,
//     @ConnectedSocket() socket: Socket,
//   ): Promise<boolean> {
//     return this.loadRoom(data, socket);
//   }

//   @SubscribeMessage('getParticipants')
//   async getParticipants(
//     @MessageBody() data: IPeerConnection,
//   ): Promise<IClientProfile[]> {
//     const room = this.rooms.get(data.room) as T;
//     if (!room) return throwRoomNotFound(null);
//     return room.participants();
//   }

//   @SubscribeMessage('leaveRoom')
//   async leaveRoom(@MessageBody() data: IPeerConnection): Promise<void> {
//     const room = this.rooms.get(data.room) as T;
//     if (!room) return throwRoomNotFound(null);
//     return room.leave(data.peerId);
//   }

//   @SubscribeMessage('createWebRTCTransport')
//   async createWebRTCTransport(
//     @MessageBody() data: IPeerTransport,
//   ): Promise<any> {
//     const room = this.rooms.get(data.room) as T;
//     if (!room) return throwRoomNotFound(null);
//     return room.createWebRtcTransport({ type: data.type }, data.peerId);
//   }

//   //Retrieves the RTP capabilities for the room's router.
//   @SubscribeMessage('getRtpCapabilities')
//   async getRtpCapabilities(@MessageBody() data: IPeerTransport): Promise<any> {
//     const room = this.rooms.get(data.room) as T;
//     if (!room) return throwRoomNotFound(null);
//     return room.getRouterRtpCapabilities();
//   }

//   @SubscribeMessage('sendMessage')
//   async onNewMessage(
//     @MessageBody() data: IRoomMessageWrapper,
//     @ConnectedSocket() socket: Socket,
//   ): Promise<any> {
//     const room = this.rooms.get(data.room) as T;
//     if (!room) return throwRoomNotFound(null);
//     return room.broadcast(socket, 'newMessage', {
//       ...data.message,
//       room: data.room,
//     });
//   }

//   // Consumes a media stream.
//   @SubscribeMessage('consume')
//   async consume(@MessageBody() data: IConsumePeerTransport): Promise<any> {
//     const room = this.rooms.get(data.room) as T;
//     if (!room) return throwRoomNotFound(null);
//     return room.consume(data);
//   }

//   @SubscribeMessage('connectWebRTCTransport')
//   async connectWebRTCTransport(
//     @MessageBody() data: IProducerConnectorTransport,
//   ): Promise<any> {
//     const room = this.rooms.get(data.room) as T;
//     if (!room) return throwRoomNotFound(null);
//     return room.connectWebRTCTransport(data);
//   }

//   // Produces a media track.
//   @SubscribeMessage('produce')
//   produce(@MessageBody() data: IProduceTrack): Promise<string> {
//     const room = this.rooms.get(data.room) as T;
//     if (room) return room.produce(data as IProduceTrack);
//     return Promise.resolve(null);
//   }

//   @SubscribeMessage('unpublishRoom')
//   unpublishRoom(@MessageBody() data: any): Promise<void> {
//     this.baseLogger.log('unpublishRoom', data);
//     const room = this.rooms.get(data.room) as T;
//     if (room) return room.close();
//     return Promise.resolve();
//   }

//   afterInit() {
//     this.baseLogger.log('Init');
//   }

//   //: A simple echo event, it returns back the number sent to it.
//   @SubscribeMessage('identity')
//   async identity(@MessageBody() data: number): Promise<number> {
//     return data;
//   }

//   handleDisconnect(client: Socket) {
//     this.baseLogger.log(`Client disconnected: ${client.id}`);
//   }

//   handleConnection(client: io.Socket) {
//     this.baseLogger.log(`Client connected: ${client.id}`);
//   }
// }
