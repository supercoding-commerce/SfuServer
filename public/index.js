const io = require('socket.io-client');
const mediasoupClient = require('mediasoup-client');
// import io from 'socket.io-client';
// import * as mediasoupClient from 'mediasoup-client';

const socket = io('ws://localhost:8081');

// Listen for connection
socket.on('connect', () => {
  console.log('Connected to the server');
});

// Define session ID, user ID, and other necessary info
// const session_id = 'your-session-id';
// const user_id = 'your-user-id';

// // Join the session
// socket.emit('join', { session_id, user_id });

// // Listen for server messages
// socket.on('message', (message) => {
//   console.log('Received message:', message);
// });

let device;
let rtpCapabilities;
let producerTransport;
let dtlsParameters;
let consumerTransport;
let producer;
let consumer;

// https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
// https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
let params = {
  // mediasoup params
  encodings: [
    {
      rid: 'r0',
      maxBitrate: 100000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r1',
      maxBitrate: 300000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r2',
      maxBitrate: 900000,
      scalabilityMode: 'S1T3',
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

const streamSuccess = async (stream) => {
  localVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  params = {
    track,
    ...params,
  };
};

const getLocalStream = () => {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          width: {
            min: 640,
            max: 1920,
          },
          height: {
            min: 400,
            max: 1080,
          },
        },
      })
      .then(streamSuccess)
      .catch((error) => {
        console.log(error.message);
      });
  } else {
    console.log("Browser doesn't support getUserMedia");
  }
};

const createDevice = async () => {
  try {
    device = new mediasoupClient.Device();
    await device.load({
      routerRtpCapabilities: rtpCapabilities,
    });

    console.log('RTP Capabilities', rtpCapabilities);
  } catch (error) {
    console.log(error);
    if (error.name === 'UnsupportedError')
      console.warn('browser not supported');
  }
};

const getRtpCapabilities = () => {
  // 서버로 요청을 전송합니다.
  socket.emit('media', { action: 'getRouterRtpCapabilities' }, (response) => {
    console.log(`Router RTP Capabilities :`, response.routerRtpCapabilities);

    rtpCapabilities = response.routerRtpCapabilities;
  });
};

const createSendTransport = () => {
  socket.emit(
    'media',
    { action: 'createWebRtcTransport', data: { type: 'producer' } },
    (response) => {
      if (response.params.error) {
        console.log(response.params.error);
        return;
      }
      console.log(response);
      producerTransport = device.createSendTransport(response.params);
      dtlsParameters = response.params.dtlsParameters;

      producerTransport.on(
        'connect',
        async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            console.log('22222222', dtlsParameters);
            await socket.emit('media', {
              action: 'connectWebRtcTransport',
              data: { dtlsParameters, type: 'producer' },
            });
            // Tell the transport that parameters were transmitted.
            callback();
          } catch (error) {
            errback(error);
          }
        },
      );

      producerTransport.on('produce', async (parameters, callback, errback) => {
        console.log('3333333', parameters);

        try {
          // tell the server to create a Producer
          // with the following parameters and produce
          // and expect back a server side producer id
          // see server's socket.on('transport-produce', ...)
          await socket.emit(
            'produce',
            {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
            },
            ({ id }) => {
              // Tell the transport that parameters were transmitted and provide it with the
              // server side producer's id.
              callback({ id });
            },
          );
        } catch (error) {
          errback(error);
        }
      });
    },
  );
};

const connectSendTransport = async () => {
  // we now call produce() to instruct the producer transport
  // to send media to the Router
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
  // this action will trigger the 'connect' and 'produce' events above
  producer = await producerTransport.produce(params);

  producer.on('trackended', () => {
    console.log('track ended');

    // close video track
  });

  producer.on('transportclose', () => {
    console.log('transport ended');

    // close video track
  });
};

const createRecvTransport = async () => {
  // see server's socket.on('consume', sender?, ...)
  // this is a call from Consumer, so sender = false
  await socket.emit(
    'media',
    { action: 'createWebRtcTransport', data: { type: 'consumer' } },
    (response) => {
      // The server sends back params needed
      // to create Send Transport on the client side
      if (response.params.error) {
        console.log(response.params.error);
        return;
      }

      console.log('44444444', response);

      // creates a new WebRTC Transport to receive media
      // based on server's consumer transport params
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-createRecvTransport
      consumerTransport = device.createRecvTransport(response.params);

      // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
      // this event is raised when a first call to transport.produce() is made
      // see connectRecvTransport() below
      dtlsParameters = response.params.dtlsParameters;
      consumerTransport.on(
        'connect',
        async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            // see server's socket.on('transport-recv-connect', ...)
            await socket.emit('media', {
              action: 'connectWebRtcTransport',
              data: { dtlsParameters, type: 'consumer' },
            });

            // Tell the transport that parameters were transmitted.
            callback();
          } catch (error) {
            // Tell the transport that something was wrong
            errback(error);
          }
        },
      );
    },
  );
};

const connectRecvTransport = async () => {
  // for consumer, we need to tell the server first
  // to create a consumer based on the rtpCapabilities and consume
  // if the router can consume, it will send back a set of params as below
  console.log(device.rtpCapabilities);
  await socket.emit(
    'media',
    {
      action: 'consume',
      rtpCapabilities: device.rtpCapabilities,
    },
    async ({ params }) => {
      if (params.error) {
        console.log('Cannot Consume');
        return;
      }

      console.log('555555', params);
      // then consume with the local consumer transport
      // which creates a consumer
      consumer = await consumerTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });

      // destructure and retrieve the video track from the producer
      const { track } = consumer;

      remoteVideo.srcObject = new MediaStream([track]);

      // the server consumer started with media paused
      // so we need to inform the server to resume
      socket.emit('producerresume');
    },
  );
};

btnLocalVideo.addEventListener('click', getLocalStream);
btnRtpCapabilities.addEventListener('click', getRtpCapabilities);
btnDevice.addEventListener('click', createDevice);
btnCreateSendTransport.addEventListener('click', createSendTransport);
btnConnectSendTransport.addEventListener('click', connectSendTransport);
btnRecvSendTransport.addEventListener('click', createRecvTransport);
btnConnectRecvTransport.addEventListener('click', connectRecvTransport);
