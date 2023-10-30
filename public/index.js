const io = require('socket.io-client');
const mediasoupClient = require('mediasoup-client');
// import io from 'socket.io-client';
// import * as mediasoupClient from 'mediasoup-client';

const session_id = 'testSession'; // 방 아이디
const producer_id = 'testProducer'; // 그때 그때 그 유저 아이디
const consumer_id = 'testConsumer';
let user_id;
let socket;

// Get radio button elements
const producerRadio = document.querySelector(
  'input[name="role"][value="producer"]',
);
const consumerRadio = document.querySelector(
  'input[name="role"][value="consumer"]',
);

// Function to set the user_id based on radio button selection
function setUserId() {
  if (producerRadio.checked) {
    user_id = producer_id;
  } else if (consumerRadio.checked) {
    user_id = consumer_id;
  }
}

// Event listeners for radio button changes
producerRadio.addEventListener('change', setUserId);
consumerRadio.addEventListener('change', setUserId);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function init() {
  setUserId();
  await sleep(5000); // Sleep for 5 seconds

  socket = io(
    //`http://localhost:8081?user_id=${user_id}&session_id=${session_id}`,
    `http://3.34.5.151:8081?user_id=${user_id}&session_id=${session_id}`,
  );

  // Listen for connection
  socket.on('connect', () => {
    console.log('Connected to the server');
  });
}

init();

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
      // rid:  RTP 스트림의 고유 식별자입니다.
      rid: 'r0',
      // 해당 RTP 스트림에 대한 최대 비트레이트를 지정합니다.
      //100,000 bits ÷ 8 = 12,500 bytes per second
      //12,500 bytes는 12.5 KB (킬로바이트)
      maxBitrate: 1000000,
      //  RTP 인코딩의 스케일러빌리티 모드를 지정합니다.
      // 여기서 'S1T3'는 1x3 모드로, 공간적 스케일러빌리티는 1이고 시간적 스케일러빌리티는 3입니다.
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r1',
      maxBitrate: 3000000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r2',
      maxBitrate: 9000000,
      scalabilityMode: 'S1T3',
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  //비디오 인코더에 사용할 시작 비트레이트를 지정합니다.
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
        audio: true,
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
    {
      action: 'createWebRtcTransport',
      data: { type: 'producer' },
    },
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
          await socket.emit(
            'media',
            {
              action: 'produce',
              data: {
                kind: parameters.kind,
                rtpParameters: parameters.rtpParameters,
                appData: parameters.appData,
              },
            },
            (id) => {
              // Tell the transport that parameters were transmitted and provide it with the
              // server side producer's id.
              console.log('444444', id);
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
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
  // 위의 'connect' and 'produce' 이벤트를 발생시킵니다.
  //mediasoup 클라이언트 라이브러리에서 produce() 메서드를 호출할 때 params를 전달하는 것은
  //클라이언트 측의 WebRTC API와 mediasoup 클라이언트 라이브러리 사이의 상호작용을 위한 것입니다.
  //이 params는 RTP 송신의 구성 및 제어에 사용되며, 서버에는 전달되지 않습니다.
  //클라이언트와 서버 간의 최소한의 정보 교환을 통해 효율적인 동작을 목표로 합니다. produce() 메서드를 호출할 때 제공되는 params는 mediasoup 클라이언트 라이브러리가 내부적으로 WebRTC RTCPeerConnection을 구성하기 위해 사용됩니다.
  //실제 RTP 파라미터 및 관련 설정은 producerTransport.on('produce', ...) 이벤트 핸들러 내에서 서버에 전송되며, 이는 mediasoup 서버가 RTP 송신을 받아들이고 처리하기 위한 설정을 제공합니다.
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
  await socket.emit(
    'media',
    {
      action: 'createWebRtcTransport',
      data: { type: 'consumer' },
      user_id: 'test-producer',
    },
    (response) => {
      if (response.params.error) {
        console.log(response.params.error);
        return;
      }

      console.log('55555555', response);

      // creates a new WebRTC Transport to receive media
      // based on server's consumer transport params
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-createRecvTransport
      consumerTransport = device.createRecvTransport(response.params);

      // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
      // this event is raised when a first call to transport.produce() is made
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
  console.log(device);
  console.log(device.rtpCapabilities);
  await socket.emit(
    'media',
    {
      action: 'consume',
      data: {
        rtpCapabilities: device.rtpCapabilities,
        kind: 'video',
        user_id: producer_id,
      },
    },
    async (response) => {
      if (response.error) {
        console.log('Cannot Consume');
        return;
      }

      console.log('666666', response);
      // then consume with the local consumer transport
      // which creates a consumer
      consumer = await consumerTransport.consume({
        id: response.id,
        producerId: response.producerId,
        kind: response.kind,
        rtpParameters: response.rtpParameters,
      });

      // destructure and retrieve the video track from the producer
      const { track } = consumer;
      console.log('7777777', track);
      remoteVideo.autoplay = true;
      remoteVideo.srcObject = new MediaStream([track]);

      // // the server consumer started with media paused
      // // so we need to inform the server to resume
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
