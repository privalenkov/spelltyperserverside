/**
 * master.js — «главный» процесс кластера.
 * 1) Слушает порт 3000 (TCP).
 * 2) «Распределяет» входящие соединения по воркерам (sticky sessions).
 */

const cluster = require('cluster');
const os = require('os');
const net = require('net');

// Хэшируем IP -> индекс воркера
function hashIP(ip) {
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // 32-bit int
  }
  return Math.abs(hash);
}

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`Master ${process.pid} is running. Forking ${numCPUs} workers...`);

  // Запускаем столько воркеров, сколько есть ядер
  const workers = [];
  for (let i = 0; i < numCPUs; i++) {
    workers.push(cluster.fork());
  }

  // Если воркер «падает», перезапустим
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    const idx = workers.indexOf(worker);
    if (idx !== -1) {
      workers.splice(idx, 1);
    }
    workers.push(cluster.fork());
  });

  // Создаём TCP-сервер на 3000
  const server = net.createServer({ pauseOnConnect: true }, (connection) => {
    const remoteAddress = connection.remoteAddress || '';
    const workerIndex = hashIP(remoteAddress) % workers.length;
    const selectedWorker = workers[workerIndex];
    selectedWorker.send('sticky-session:connection', connection);
  });

  server.listen(3000, () => {
    console.log(`Master listening on port 3000`);
  });

} else {
  // Воркеры запускают реальный сервер
  require('./worker');
}
