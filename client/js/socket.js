export function connectSocket() {
  const ioUrl = window.location.origin;
  const socket = io(ioUrl, { transports: ['websocket'] });
  return socket;
}
