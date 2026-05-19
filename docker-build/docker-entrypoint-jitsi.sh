#!/usr/bin/env bash
# Run all init scripts in /etc/cont-init.d/, then exec the container CMD.
set -eu

if [[ -d /etc/cont-init.d ]]; then
    for script in $(find /etc/cont-init.d -maxdepth 1 -type f | sort); do
        if [[ -x "${script}" ]]; then
            echo "[entrypoint] running ${script}"
            "${script}"
        fi
    done
fi

exec "$@"
