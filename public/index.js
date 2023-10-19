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
let consumerTransport;
let producer;
let consumer;

// https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
// https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
let params = {
  // mediasoup params
  //   encodings: [
  //     {
  //       rid: 'r0',
  //       maxBitrate: 100000,
  //       scalabilityMode: 'S1T3',
  //     },
  //     {
  //       rid: 'r1',
  //       maxBitrate: 300000,
  //       scalabilityMode: 'S1T3',
  //     },
  //     {
  //       rid: 'r2',
  //       maxBitrate: 900000,
  //       scalabilityMode: 'S1T3',
  //     },
  //   ],
  //   // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  //   codecOptions: {
  //     videoGoogleStartBitrate: 1000,
  //   },
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
    },
  );
};

btnLocalVideo.addEventListener('click', getLocalStream);
btnRtpCapabilities.addEventListener('click', getRtpCapabilities);
btnDevice.addEventListener('click', createDevice);
btnCreateSendTransport.addEventListener('click', createSendTransport);
// btnConnectSendTransport.addEventListener('click', connectSendTransport)
// btnRecvSendTransport.addEventListener('click', createRecvTransport)
// btnConnectRecvTransport.addEventListener('click', connectRecvTransport)
