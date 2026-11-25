#!/bin/sh
# Cursor hook: 把事件转给本地状态服务，失败不影响 Cursor。参数 prompt 时需回 continue
curl -s -m 1 -X POST --data-binary @- http://127.0.0.1:8787/hook >/dev/null 2>&1
[ "$1" = prompt ] && echo '{"continue":true}'
exit 0
