#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import json
from pathlib import PurePosixPath
import re
import socket
import struct
import subprocess
import sys
from typing import Any, Iterator


COMMIT_NAME = 'Eurikon'
COMMIT_EMAIL = '40998416+Eurikon@users.noreply.github.com'
COMMIT_IDENTITY = f'{COMMIT_NAME} <{COMMIT_EMAIL}>'.encode()


PATTERNS = {
    'absolute account path': rb'(?<![A-Za-z0-9_])/(?:Users|home)/[A-Za-z0-9_.-]+(?:/|\b)',
    'machine temporary path': rb'/(?:private/)?var/folders/[A-Za-z0-9_/-]+',
    'physical serial node': rb'(?:/dev/)?(?:cu|tty)\.usbmodem[A-Za-z0-9_-]+',
    'unique identifier': rb'\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b',
    'network hardware address': rb'\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b',
    'private network address': rb'\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b',
    'private key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'access token': rb'\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b',
    'embedded credential': rb'(?i)(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["\x27]?\s*[:=]\s*["\x27][A-Za-z0-9+/=_-]{12,}["\x27]',
}
LOCAL_KEYS = {
    'deviceuid', 'midisocket', 'registryid', 'locationid', 'ioregistryentryid',
    'ioplatformuuid', 'ioplatformserialnumber', 'serialnumber', 'displayserial',
    'hardwareuuid', 'hostname', 'computername', 'username', 'homedirectory',
    'pid', 'processid', 'finalapppid', 'reopenedapppid', 'displayid', 'edid',
}


def git(*arguments: str) -> bytes:
    return subprocess.check_output(['git', *arguments])


def local_fields(value: Any) -> Iterator[str]:
    if isinstance(value, dict):
        for key, item in value.items():
            name = re.sub('[^a-z0-9]', '', key.lower())
            neutral = item is None or isinstance(item, str) and item.startswith('<') and item.endswith('>')
            if name in LOCAL_KEYS and not neutral:
                yield key
            yield from local_fields(item)
    elif isinstance(value, list):
        for item in value:
            yield from local_fields(item)


def png_metadata(data: bytes) -> list[str]:
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        return []
    offset = 8
    while offset < len(data):
        if offset + 12 > len(data):
            return ['invalid PNG container']
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        if offset + length + 12 > len(data):
            return ['invalid PNG container']
        if kind in (b'eXIf', b'tEXt', b'zTXt', b'iTXt', b'tIME'):
            return ['PNG metadata requires sanitization']
        offset += length + 12
    return []


def scan_blob(path: str, data: bytes) -> list[str]:
    findings = png_metadata(data)
    file = PurePosixPath(path)
    if path.startswith('sources/') or file.suffix.lower() in ('.pkg', '.dmg', '.msi', '.exe', '.pem', '.key', '.p12', '.pfx', '.pid', '.sock', '.log'):
        findings.append('excluded archive, credential or local artifact')
    if '.local' in file.parts or re.search(r'\.local\.(json|toml|plist)$', path) or file.name.startswith('.env') and file.name != '.env.example':
        findings.append('local configuration')
    for reason, pattern in PATTERNS.items():
        if re.search(pattern, data):
            findings.append(reason)
    identities = {getpass.getuser(), socket.gethostname()}
    for identity in identities - {'root', 'runner', 'user', 'test', 'admin'}:
        if len(identity) >= 4 and re.search(rb'(?<![A-Za-z0-9_])' + re.escape(identity.encode()) + rb'(?![A-Za-z0-9_])', data, re.I):
            findings.append('local account or hostname')
    if file.suffix == '.json':
        try:
            findings.extend('local metadata field: ' + key for key in local_fields(json.loads(data)))
        except (ValueError, UnicodeDecodeError):
            findings.append('invalid JSON')
    return sorted(set(findings))


def entries(revision: str | None = None) -> Iterator[tuple[str, str]]:
    if revision:
        records = git('ls-tree', '-r', '-z', revision).split(b'\0')
    else:
        records = git('ls-files', '--stage', '-z').split(b'\0')
    for record in filter(None, records):
        info, path = record.split(b'\t', 1)
        mode, second, third = info.split()
        if mode == b'160000':
            continue
        if not revision and third != b'0':
            raise ValueError('Resolve index conflicts before privacy review')
        yield path.decode(), (third if revision else second).decode()


def audit(history: bool = False) -> tuple[list[tuple[str, str]], int]:
    revisions = git('rev-list', '--all').decode().splitlines() if history else [None]
    seen = set()
    failures = []
    if not history:
        for role in ('AUTHOR', 'COMMITTER'):
            identity = git('var', f'GIT_{role}_IDENT').split(b'>', 1)[0] + b'>'
            if identity != COMMIT_IDENTITY:
                failures.append(('commit ' + role.lower(), 'identity must be Eurikon with the project noreply address'))
    for revision in revisions:
        if revision:
            author, committer, message = git('show', '-s', '--format=%an <%ae>%x00%cn <%ce>%x00%B', revision).split(b'\0', 2)
            for role, identity in (('author', author), ('committer', committer)):
                if identity != COMMIT_IDENTITY:
                    failures.append(('commit ' + revision[:12], role + ' must be Eurikon with the project noreply address'))
            failures.extend(('commit ' + revision[:12], reason) for reason in scan_blob('commit-message', message))
        for path, digest in entries(revision):
            if (path, digest) in seen:
                continue
            seen.add((path, digest))
            failures.extend((path, reason) for reason in scan_blob(path, git('cat-file', 'blob', digest)))
    return failures, len(seen)


def main() -> int:
    parser = argparse.ArgumentParser(description='Review indexed files or reachable project history for private machine data.')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--history', action='store_true')
    mode.add_argument('--staged', action='store_true')
    args = parser.parse_args()
    try:
        failures, count = audit(args.history)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print('Privacy review failed: ' + str(error), file=sys.stderr)
        return 1
    for path, reason in failures:
        print(path + ': ' + reason, file=sys.stderr)
    if failures:
        print('Publication blocked; remove or sanitize the reported content.', file=sys.stderr)
        return 1
    print(f'PASS: privacy review of {count} file versions.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
