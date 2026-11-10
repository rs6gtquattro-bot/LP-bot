# Тесты tools/vk_tunnel.py. Без сети: только под unshare -rn, иначе FAIL. SSH и VK не используются.
# Запуск: unshare -rn /workspace/.sshvenv/bin/python tests/vk_tunnel_test.py
import os, socket, struct, sys, threading
names = {n for _, n in socket.if_nameindex()}
if names - {'lo'}:
    print(f'FAIL сеть доступна ({", ".join(sorted(names - {"lo"}))}): запускай тест только под unshare -rn')
    print('ИТОГ: провалов 1'); sys.exit(1)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
import vk_tunnel as vt

res = []
def check(name, ok, detail=''):
    res.append(ok); print(f"{'OK  ' if ok else 'FAIL'} {name}" + (f'\n     {detail}' if detail and not ok else ''))

# 1. белый список
allow = ['api.vk.com', 'API.VK.COM.', 'oauth.vk.com', 'lp.vk.com', 'im.vk.com', 'sun1-1.userapi.com', 'x.vk.ru', 'pp.vk.com']
deny = ['vk.com.evil.org', 'evilvk.com', 'tile.openstreetmap.org', 'openrouter.ai', 'vk.com', '.vk.com', 'api.ipify.org', '']
check('1. белый список: VK-имена пропускаются', all(vt.host_allowed(h, 443) for h in allow), str([h for h in allow if not vt.host_allowed(h, 443)]))
check('2. белый список: прочие имена и подделки отклоняются', not any(vt.host_allowed(h, 443) for h in deny), str([h for h in deny if vt.host_allowed(h, 443)]))
check('3. только порт 443', not vt.host_allowed('api.vk.com', 80) and not vt.host_allowed('api.vk.com', 22))
import re as _re
_src = open(os.path.join(os.path.dirname(__file__), '..', 'tools', 'vk_tunnel.py'), encoding='utf-8').read()
_env = set(_re.findall(r"os\.environ(?:\.get)?[\[(]'([A-Z_]+)'", _src))
check('4. белый список только в коде: из окружения читаются лишь доступ к ПК, порт и known_hosts', _env <= {'PC_SERVER_HOST', 'PC_SERVER_PORT', 'PC_SERVER_USER', 'PC_SERVER_SECRET', 'LP_TUNNEL_PORT', 'LP_TUNNEL_KNOWN_HOSTS'} and 'PC_SERVER_HOST' in _env, str(sorted(_env)))
bad = ['evil.org\x00.vk.com', 'evil.org .vk.com', 'a/b.vk.com', 'a_b.vk.com', '-a.vk.com', 'a..vk.com', ('a' * 64) + '.vk.com', 'evil.org\n.vk.com', 'evil.org:443.vk.com']
check('4a. строгая проверка имён: управляющие символы, пробел, «/», «_», пустые и длинные части — отказ', not any(vt.host_allowed(h, 443) for h in bad), str([h for h in bad if vt.host_allowed(h, 443)]))
check('4b. nominatim.openstreetmap.org: разрешён только на 443, соседние имена — нет', vt.host_allowed('nominatim.openstreetmap.org', 443) and not vt.host_allowed('nominatim.openstreetmap.org', 80) and not vt.host_allowed('tile.openstreetmap.org', 443) and not vt.host_allowed('x.nominatim.openstreetmap.org', 443))

# SOCKS5 поверх socketpair, канал SSH подменён
def run(req, opened):
    a, b = socket.socketpair()
    class FakeCh:
        def __init__(s): s.peer, s.mine = socket.socketpair()
        def fileno(s): return s.mine.fileno()
        def recv(s, n): return s.mine.recv(n)
        def sendall(s, d): return s.mine.sendall(d)
        def close(s): s.mine.close()
    def opener(h, p, src):
        opened.append((h, p)); ch = FakeCh(); ch.peer.sendall(b'PONG'); return ch
    t = threading.Thread(target=vt.handle, args=(b, ('127.0.0.1', 5555), vt.Tunnel(open_channel=opener)), daemon=True)
    t.start()
    a.settimeout(3)
    a.sendall(b'\x05\x01\x00'); greet = a.recv(2)
    a.sendall(req)
    rep = vt.recv_exact(a, 10)
    extra = b''
    if rep[1] == 0:
        extra = vt.recv_exact(a, 4)
    a.close(); t.join(3)
    return greet, rep[1], extra

def dom(h, port=443): hb = h.encode(); return b'\x05\x01\x00\x03' + bytes([len(hb)]) + hb + struct.pack('!H', port)
vt.log = lambda m: DBG.append(m)
DBG = []

o = []; g, code, data = run(dom('api.vk.com'), o)
check('5. CONNECT api.vk.com:443 идёт в SSH-канал', g == b'\x05\x00' and code == 0 and o == [('api.vk.com', 443)] and data == b'PONG', f'code={code} opened={o}')
o = []; _, code, _ = run(dom('example.org'), o)
check('6. чужое имя: отказ 0x02, канал не открывается', code == 2 and o == [], f'code={code} opened={o}')
o = []; _, code, _ = run(b'\x05\x01\x00\x01' + socket.inet_aton('87.240.132.78') + struct.pack('!H', 443), o)
check('7. голый IPv4 (даже IP VK): отказ, канал не открывается', code == 2 and o == [], f'code={code}')
o = []; _, code, _ = run(b'\x05\x01\x00\x04' + b'\0' * 16 + struct.pack('!H', 443), o)
check('8. голый IPv6: отказ', code == 2 and o == [])
o = []; _, code, _ = run(b'\x05\x02\x00\x03' + bytes([10]) + b'api.vk.com' + struct.pack('!H', 443), o)
check('9. BIND/не-CONNECT: отказ 0x07', code == 7 and o == [])
o = []; _, code, _ = run(dom('api.vk.com', 80), o)
check('10. api.vk.com:80: отказ', code == 2 and o == [])
o = []; _, code, _ = run(dom('evil.org\x00.vk.com'), o)
check('10b. SOCKS: evil.org\\x00.vk.com — отказ, канал не открывается', code == 2 and o == [])
o = []; g, code, data = run(dom('nominatim.openstreetmap.org'), o)
check('10c. SOCKS: nominatim.openstreetmap.org:443 идёт в SSH-канал', code == 0 and o == [('nominatim.openstreetmap.org', 443)])
o = []; _, code, _ = run(b'\x05\x01\x00\x03' + bytes([11]) + 'api.vk.сom'.encode() [:11] + struct.pack('!H', 443), o)
check('10a. имя не ASCII (подделка кириллицей): отказ', code == 2 and o == [], f'code={code} opened={o}')

# 11. упал SSH: клиент получает ошибку 0x01, без обхода
def broken(h, p, src): raise EOFError('ssh down')
a, b = socket.socketpair(); a.settimeout(3)
t = threading.Thread(target=vt.handle, args=(b, ('127.0.0.1', 1), vt.Tunnel(open_channel=broken)), daemon=True); t.start()
a.sendall(b'\x05\x01\x00'); a.recv(2); a.sendall(dom('api.vk.com')); code = vt.recv_exact(a, 10)[1]; a.close(); t.join(3)
check('11. туннель упал: ответ 0x01, соединение закрыто', code == 1)

# 12. пароль и адрес ПК не попадают в лог
logs = []; vt.log = logs.append
os.environ.update(PC_SERVER_HOST='pc.example.invalid', PC_SERVER_USER='u', PC_SERVER_SECRET='SECRET_MARKER_123')
try:
    vt.Tunnel()._transport()
except Exception as e:
    logs.append(f'{type(e).__name__}')
src = open(os.path.join(os.path.dirname(__file__), '..', 'tools', 'vk_tunnel.py'), encoding='utf-8').read()
check('12. в лог не пишутся пароль и адрес ПК', bool(logs) and not any('SECRET_MARKER_123' in l or 'pc.example.invalid' in l for l in logs), str(logs))
check('13. исходник: функция log не трогает PC_SERVER_SECRET', 'PC_SERVER_SECRET' not in src.split('def log')[1].split('class Tunnel')[0])
check('14. ключ хоста закреплён: RejectPolicy, AutoAddPolicy нет', 'RejectPolicy' in src and 'AutoAddPolicy' not in src)
check('15. слушает только 127.0.0.1', "srv.bind(('127.0.0.1'" in src and '0.0.0.0' not in src)

print(f"ИТОГ: {'все тесты пройдены' if all(res) else f'провалов {res.count(False)}'}")
sys.exit(0 if all(res) else 1)
