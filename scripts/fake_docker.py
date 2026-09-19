#!/usr/bin/env python3
"""Fake Docker daemon (unix socket) untuk membuat Wings tetap hidup di Railway.

Menangani endpoint yang di-ping Wings saat boot:
  GET /_ping            -> 200 + header Api-Version
  GET /version          -> JSON ServerVersion
  GET /info             -> JSON minimal
  GET /containers/json  -> []
  lainnya               -> 501 (wings akan menandai operasi gagal, proses tetap hidup)
"""
import json
import os
import socket
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

SOCKET = "/var/run/docker.sock"
API_VER = "1.47"
ENGINE_VER = "27.3.1"

VERSION_INFO = {
    "Platform": {"Name": "Docker Engine - Community (fake)"},
    "Components": [
        {
            "Name": "Engine",
            "Version": ENGINE_VER,
            "Details": {
                "ApiVersion": API_VER,
                "MinAPIVersion": "1.24",
                "GitCommit": "fake0000",
                "GoVersion": "go1.22.7",
                "Os": "linux",
                "Arch": "amd64",
                "KernelVersion": "6.8.0-fake",
                "BuildTime": "2024-09-20T11:41:11Z",
            },
        }
    ],
    "Version": ENGINE_VER,
    "ApiVersion": API_VER,
    "MinAPIVersion": "1.24",
    "GitCommit": "fake0000",
    "GoVersion": "go1.22.7",
    "Os": "linux",
    "Arch": "amd64",
    "KernelVersion": "6.8.0-fake",
    "BuildTime": "2024-09-20T11:41:11Z",
}

NETWORK = {
    "Name": "pterodactyl_nw",
    "Id": "fakenet0000000000000000000000000000000000000000000000000000000000",
    "Created": "2024-09-20T11:41:11Z",
    "Scope": "local",
    "Driver": "bridge",
    "EnableIPv6": False,
    "IPAM": {
        "Driver": "default",
        "Options": None,
        "Config": [{"Subnet": "172.18.0.0/16", "Gateway": "172.18.0.1"}],
    },
    "Internal": False,
    "Attachable": False,
    "Ingress": False,
    "ConfigFrom": {"Network": ""},
    "ConfigOnly": False,
    "Containers": {},
    "Options": {},
    "Labels": {},
}

INFO = {
    "ID": "FAKE:DOCKER:RAILWAY",
    "Containers": 0,
    "ContainersRunning": 0,
    "ContainersPaused": 0,
    "ContainersStopped": 0,
    "Images": 0,
    "Driver": "overlay2",
    "MemoryLimit": True,
    "SwapLimit": True,
    "CpuCfsPeriod": True,
    "CpuCfsQuota": True,
    "Debug": False,
    "NFd": 20,
    "NGoroutines": 30,
    "LoggingDriver": "json-file",
    "OperatingSystem": "Alpine Linux (fake dockerd)",
    "OSType": "linux",
    "ServerVersion": ENGINE_VER,
    "Architecture": "x86_64",
    "NCPU": 1,
    "MemTotal": 1073741824,
    "DockerRootDir": "/var/lib/docker",
    "Name": "railway-wings",
    "Plugins": {
        "Volume": ["local"],
        "Network": ["bridge", "host", "null"],
        "Authorization": None,
        "Log": ["json-file"],
    },
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            data = json.dumps(body).encode()
        elif isinstance(body, str):
            data = body.encode()
        else:
            data = body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            self.send_header(k, str(v))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _route(self):
        p = self.path
        # strip versi API: /v1.47/version -> /version
        parts = p.split("/", 2)
        if len(parts) == 3 and parts[1].startswith("v"):
            p = "/" + parts[2]
        if p in ("/_ping", "/_ping/"):
            return self._send(
                200, "OK", "text/plain",
                {
                    "Api-Version": API_VER,
                    "Docker-Experimental": "false",
                    "Ostype": "linux",
                    "Builder-Version": "1",
                    "Cache-Control": "no-cache",
                },
            )
        if p == "/version":
            return self._send(200, VERSION_INFO)
        if p == "/containers/json":
            return self._send(200, [])
        if p == "/networks":
            return self._send(200, [NETWORK])
        if p.startswith("/networks/create") or p == "/networks/create":
            return self._send(201, {"Id": "fakenet0000000000000000000000000000000000000000000000000000000000", "Warning": ""})
        if p == "/networks/prune":
            return self._send(200, {"Networks": []})
        if p.startswith("/networks/"):
            # wings cek keberadaan network pterodactyl_nw saat boot -> anggap ada
            return self._send(200, NETWORK)
        if p == "/info":
            return self._send(200, INFO)
        if p.startswith("/events"):
            # wings kadang subscribe events; tahan koneksi lalu tutup
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.close_connection = True
            return
        return self._send(
            501,
            {"message": "fake dockerd: operasi tidak didukung di Railway (%s)" % p},
        )

    def do_GET(self):
        self._route()

    def do_HEAD(self):
        self._route()

    def do_POST(self):
        self._route()

    def do_DELETE(self):
        self._route()


class UnixHTTPServer(ThreadingMixIn, HTTPServer):
    address_family = socket.AF_UNIX
    daemon_threads = True

    def server_bind(self):
        try:
            os.unlink(SOCKET)
        except FileNotFoundError:
            pass
        HTTPServer.server_bind(self)


if __name__ == "__main__":
    os.makedirs(os.path.dirname(SOCKET), exist_ok=True)
    srv = UnixHTTPServer(SOCKET, Handler)
    os.chmod(SOCKET, 0o666)
    print("fake dockerd listening on " + SOCKET, flush=True)
    srv.serve_forever()
