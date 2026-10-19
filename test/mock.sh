#!/bin/bash
# usage: test/mock.sh start|stop
PIDF=/var/lib/kgtest-mock.pid
if [ -f $PIDF ]; then kill $(cat $PIDF) 2>/dev/null; rm -f $PIDF; sleep 1; fi
if [ "$1" = "start" ]; then
  cd "$(dirname "$0")/.."
  nohup node test/mock-server.mjs /var/lib/kgtest > /var/lib/kgtest-mock.log 2>&1 &
  echo $! > $PIDF; sleep 1.5; cat /var/lib/kgtest-mock.log
fi
