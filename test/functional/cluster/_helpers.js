exports.disconnect = function (clients, callback) {
  var pending = 0;

  for (var i = 0; i < clients.length; ++i) {
    pending += 1;
    clients[i].disconnect(check);
  }

  function check() {
    if (!--pending && callback) {
      callback();
    }
  }
}
