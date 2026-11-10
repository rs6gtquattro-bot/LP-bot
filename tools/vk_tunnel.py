#!/usr/bin/env python3
"""SOCKS5 на 127.0.0.1 -> SSH-туннель до ПК владельца (WSL) -> VK.

Только для VK-клиента бота (config.json: vk.proxy = socks5h://127.0.0.1:1080).
- Принимает только CONNECT с доменным именем (socks5h). Голые IPv4/IPv6 отклоняются.
- Пропускает только имена из белого списка VK и только порт 443.
- Ключ хоста ПК закреплён в файле known_hosts (LP_TUNNEL_KNOWN_HOSTS); чужой ключ -> отказ.
- Пароль и адрес ПК берутся из env (PC_SERVER_*), в лог и аргументы не пишутся.
Запуск: set -a; source /home/box/secrets/pc_server.env; set +a;
        /workspace/.sshvenv/bin/python tools/vk_tunnel.py
"""
import os, select, socket, struct, sys, threading, time

VK_EXACT = {'api.vk.com', 'oauth.vk.com', 'lp.vk.com', 'im.vk.com'}
VK_SUFFIX = ('.vk.com', '.vk.ru', '.userapi.com')
ALLOWED_PORTS = {443}

# SOCKS5 коды ответа
REP_OK, REP_FAIL, REP_NOT_ALLOWED, REP_CMD, REP_ATYP = 0x00, 0x01, 0x02, 0x07, 0x08


def extra_hosts():
    raw = os.environ.get('LP_TUNNEL_EXTRA_HOSTS', '')
    return {h.strip().lower().rstrip('.') for h in raw.split(',') if h.strip()}


def host_allowed(host, port, extra=frozenset()):
    if port not in ALLOWED_PORTS:
        return False
    h = (host or '').lower().rstrip('.')
    if not h or len(h) > 253:
        return False
    if h in VK_EXACT or h in extra:
        return True
    return any(h.endswith(s) and len(h) > len(s) for s in VK_SUFFIX)


def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('клиент закрыл соединение')
        buf += chunk
    return buf


def reply(sock, code):
    sock.sendall(struct.pack('!BBBB4sH', 5, code, 0, 1, b'\0\0\0\0', 0))


def handshake(sock, extra=frozenset()):
    """Разбирает SOCKS5-запрос. Возвращает (host, port) или (None, причина) после отправки отказа."""
    ver, nmethods = recv_exact(sock, 2)
    if ver != 5:
        return None, 'не SOCKS5'
    methods = recv_exact(sock, nmethods)
    if 0 not in methods:
        sock.sendall(b'\x05\xff')
        return None, 'нет метода без авторизации'
    sock.sendall(b'\x05\x00')
    ver, cmd, _rsv, atyp = recv_exact(sock, 4)
    if cmd != 1:
        reply(sock, REP_CMD)
        return None, 'команда не CONNECT'
    if atyp == 3:
        raw = recv_exact(sock, recv_exact(sock, 1)[0])
        try:
            host = raw.decode('ascii')
        except UnicodeDecodeError:
            reply(sock, REP_NOT_ALLOWED)
            return None, 'имя не ASCII'
    elif atyp in (1, 4):
        recv_exact(sock, 4 if atyp == 1 else 16)
        recv_exact(sock, 2)
        reply(sock, REP_NOT_ALLOWED)
        return None, 'голый IP запрещён'
    else:
        reply(sock, REP_ATYP)
        return None, 'неизвестный тип адреса'
    port = struct.unpack('!H', recv_exact(sock, 2))[0]
    if not host_allowed(host, port, extra):
        reply(sock, REP_NOT_ALLOWED)
        return None, f'запрещено: {host}:{port}'
    return (host, port), None


def pipe(a, b):
    try:
        while True:
            r, _, _ = select.select([a, b], [], [], 300)
            if not r:
                return
            for s in r:
                data = s.recv(65536)
                if not data:
                    return
                (b if s is a else a).sendall(data)
    except Exception:
        return
    finally:
        for s in (a, b):
            try:
                s.close()
            except Exception:
                pass


def log(msg):
    print(time.strftime('[%Y-%m-%d %H:%M:%S]'), msg, flush=True)


class Tunnel:
    def __init__(self, open_channel=None):
        self._open = open_channel
        self._t = None
        self._lock = threading.Lock()

    def _transport(self):
        import paramiko
        with self._lock:
            if self._t is not None and self._t.is_active():
                return self._t
            h = os.environ['PC_SERVER_HOST'].strip()
            port = int(os.environ.get('PC_SERVER_PORT', '22') or 22)
            if h.count(':') == 1:
                h, p = h.split(':')
                port = int(p)
            kh = os.environ.get('LP_TUNNEL_KNOWN_HOSTS', '/workspace/lp-recovery/run/pc_known_hosts')
            c = paramiko.SSHClient()
            c.load_host_keys(kh)                       # закреплённый ключ ПК
            c.set_missing_host_key_policy(paramiko.RejectPolicy())
            c.connect(h, port=port, username=os.environ['PC_SERVER_USER'].strip(),
                      password=os.environ['PC_SERVER_SECRET'].strip(), timeout=15,
                      allow_agent=False, look_for_keys=False)
            t = c.get_transport()
            t.set_keepalive(30)
            self._client, self._t = c, t
            log('SSH до ПК: подключено')
            return t

    def open(self, host, port, src):
        if self._open:
            return self._open(host, port, src)
        return self._transport().open_channel('direct-tcpip', (host, port), src, timeout=20)


def handle(conn, addr, tunnel, extra):
    try:
        conn.settimeout(20)
        dest, why = handshake(conn, extra)
        if dest is None:
            log(f'ОТКАЗ {why}')
            conn.close()
            return
        try:
            ch = tunnel.open(dest[0], dest[1], addr)
        except Exception as e:
            log(f'ОШИБКА канала до {dest[0]}:{dest[1]}: {type(e).__name__}')
            reply(conn, REP_FAIL)
            conn.close()
            return
        reply(conn, REP_OK)
        conn.settimeout(None)
        log(f'OK {dest[0]}:{dest[1]}')
        pipe(conn, ch)
    except Exception as e:
        log(f'ОШИБКА {type(e).__name__}')
        try:
            conn.close()
        except Exception:
            pass


def serve(listen_port, tunnel, extra=frozenset(), ready=None):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(('127.0.0.1', listen_port))                 # только петля
    srv.listen(64)
    log(f'SOCKS5 на 127.0.0.1:{srv.getsockname()[1]}, белый список VK, порт 443')
    if ready:
        ready(srv)
    while True:
        conn, addr = srv.accept()
        threading.Thread(target=handle, args=(conn, addr, tunnel, extra), daemon=True).start()


def main():
    for k in ('PC_SERVER_HOST', 'PC_SERVER_USER', 'PC_SERVER_SECRET'):
        if not os.environ.get(k):
            log(f'нет переменной {k}')
            sys.exit(2)
    port = int(os.environ.get('LP_TUNNEL_PORT', '1080'))
    extra = extra_hosts()
    if extra:
        log(f'ВРЕМЕННО добавлены имена: {sorted(extra)}')
    tunnel = Tunnel()
    tunnel._transport()                                   # проверка ключа хоста и входа сразу при старте
    serve(port, tunnel, frozenset(extra))


if __name__ == '__main__':
    main()
