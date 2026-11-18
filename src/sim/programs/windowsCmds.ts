import { CommandExecutionResult, ProgramContext } from './types';
import { listDirEntries, normalizeWindowsPath, readFileNode } from '../vfs/vfs';
import { getGuideOutput, getHelpOutput } from './guide';
import { getClusterStore } from '../core/store';

export function executeWindowsCommand(
  cmd: string,
  ctx: ProgramContext
): CommandExecutionResult | null {
  const lower = cmd.toLowerCase();
  const { args, frame, state } = ctx;

  if (lower === 'cls') {
    return { output: '', clearScreen: true };
  }

  if (lower === 'ver') {
    return { output: '\nMicrosoft Windows [Version 10.0.22631.4602]' };
  }

  if (lower === 'hostname') {
    return { output: frame.hostId };
  }

  if (lower === 'whoami') {
    return {
      output: frame.hostId === 'VAANISHKA-LT' ? 'vaanishka-lt\\vaanishka' : 'yotta-corp\\employee'
    };
  }

  if (lower === 'guide') {
    return { output: getGuideOutput() };
  }

  if (lower === 'help') {
    return { output: getHelpOutput(ctx.windowRole, 'cmd') };
  }

  if (lower === 'sim-reset') {
    getClusterStore().reset();
    return { output: 'Simulator cluster state reset to initial converged baseline.' };
  }

  if (lower === 'set') {
    if (args.length === 0) {
      return {
        output: Object.entries(frame.env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      };
    }
    const raw = ctx.rawLine.trim().slice(3).trim();
    const eqIdx = raw.indexOf('=');
    if (eqIdx !== -1) {
      const key = raw.slice(0, eqIdx).trim();
      const val = raw.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
      frame.env[key] = val;
      return { output: '' };
    }
    const prefix = raw.toLowerCase();
    const matches = Object.entries(frame.env)
      .filter(([k]) => k.toLowerCase().startsWith(prefix))
      .map(([k, v]) => `${k}=${v}`);
    if (matches.length === 0) {
      return { output: `Environment variable ${raw} not defined` };
    }
    return { output: matches.join('\n') };
  }

  if (lower === 'echo') {
    let text = ctx.rawLine.trim().slice(4).trim();
    text = text.replace(/%([^%]+)%/g, (_: string, varName: string) => frame.env[varName] || `%${varName}%`);
    return { output: text };
  }

  if (lower === 'cd' || lower === 'chdir') {
    if (args.length === 0) {
      return { output: frame.cwd };
    }
    const target = normalizeWindowsPath(frame.cwd, args.join(' '));
    const node = readFileNode(state, frame.hostId, target);
    if (!node || node.type !== 'dir') {
      return { output: 'The system cannot find the path specified.' };
    }
    frame.cwd = target;
    return { output: '' };
  }

  if (lower === 'dir') {
    const target = args[0] ? normalizeWindowsPath(frame.cwd, args[0]) : frame.cwd;
    const entries = listDirEntries(state, frame.hostId, target);
    const lines = [
      ' Volume in drive C is Windows-SSD',
      ' Volume Serial Number is 94E1-4B2C',
      '',
      ` Directory of ${target}`,
      '',
      '17/11/2026  09:00    <DIR>          .',
      '17/11/2026  09:00    <DIR>          ..'
    ];
    let fileCount = 0;
    let dirCount = 2;
    let totalBytes = 0;
    for (const e of entries) {
      if (e.node.type === 'dir') {
        dirCount++;
        lines.push(`17/11/2026  09:00    <DIR>          ${e.name}`);
      } else {
        fileCount++;
        const len = (e.node.content || '').length;
        totalBytes += len;
        lines.push(`17/11/2026  09:00        ${String(len).padStart(10, ' ')} ${e.name}`);
      }
    }
    lines.push(`               ${fileCount} File(s)          ${totalBytes} bytes`);
    lines.push(`               ${dirCount} Dir(s)  412,841,197,568 bytes free`);
    return { output: lines.join('\n') };
  }

  if (lower === 'type') {
    if (!args[0]) return { output: 'The syntax of the command is incorrect.' };
    const target = normalizeWindowsPath(frame.cwd, args[0]);
    const node = readFileNode(state, frame.hostId, target);
    if (!node || node.type !== 'file') {
      return { output: 'The system cannot find the file specified.' };
    }
    return { output: node.content || '' };
  }

  if (lower === 'where') {
    const bin = (args[0] || '').toLowerCase();
    const map: Record<string, string> = {
      boundary: 'C:\\Program Files\\HashiCorp\\Boundary\\boundary.exe',
      ssh: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
      psql: 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
      curl: 'C:\\Windows\\System32\\curl.exe',
      ping: 'C:\\Windows\\System32\\PING.EXE',
      ipconfig: 'C:\\Windows\\System32\\ipconfig.exe',
      nslookup: 'C:\\Windows\\System32\\nslookup.exe',
      tracert: 'C:\\Windows\\System32\\TRACERT.EXE'
    };
    if (map[bin]) return { output: map[bin] };
    return { output: 'INFO: Could not find files for the given pattern(s).' };
  }

  if (lower === 'findstr') {
    const pattern = args[args.length - 1]?.replace(/^"|"$/g, '') || '';
    const input = ctx.stdin || '';
    const matched = input
      .split('\n')
      .filter((line: string) => line.toLowerCase().includes(pattern.toLowerCase()));
    return { output: matched.join('\n') };
  }

  if (lower === 'ipconfig') {
    const ip = state.hosts[frame.hostId].ip;
    return {
      output: `
Windows IP Configuration


Ethernet adapter Ethernet0:

   Connection-specific DNS Suffix  . : corp.yotta.lab
   IPv4 Address. . . . . . . . . . . : ${ip}
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.1.1`
    };
  }

  if (lower === 'nslookup') {
    const hostArg = (args[0] || '').toLowerCase();
    if (!hostArg) {
      return { output: 'Default Server:  dc01.corp.yotta.lab\nAddress:  192.168.1.10' };
    }
    if (hostArg === 'boundary.yotta.lab') {
      return {
        output: `Server:  dc01.corp.yotta.lab
Address:  192.168.1.10

Non-authoritative answer:
Name:    boundary.yotta.lab
Address:  10.10.0.100`
      };
    }
    if (hostArg === 'ldap.corp.yotta.lab') {
      return {
        output: `Server:  dc01.corp.yotta.lab
Address:  192.168.1.10

Name:    ldap.corp.yotta.lab
Address:  192.168.1.10`
      };
    }
    return {
      output: `Server:  dc01.corp.yotta.lab
Address:  192.168.1.10

*** dc01.corp.yotta.lab can't find ${hostArg}: Non-existent domain`
    };
  }

  if (lower === 'ping') {
    const target = args.find((a: string) => !a.startsWith('-')) || '';
    if (!target) return { output: 'Usage: ping [-t] [-n count] target_name' };

    const resolvedIp =
      target.toLowerCase() === 'boundary.yotta.lab'
        ? '10.10.0.100'
        : target.toLowerCase() === 'ldap.corp.yotta.lab'
          ? '192.168.1.10'
          : target;

    const isEmployeeBlocked =
      ctx.windowRole === 'employee' &&
      resolvedIp.startsWith('10.10.0.') &&
      resolvedIp !== '10.10.0.100';

    const displayTarget =
      ctx.windowRole === 'employee' && /^10\.10\.0\.3[012]$/.test(resolvedIp)
        ? 'restricted-subnet-host [filtered]'
        : resolvedIp;

    if (isEmployeeBlocked) {
      return {
        delayMs: 180,
        output: `
Pinging ${displayTarget} with 32 bytes of data:
Request timed out.
Request timed out.
Request timed out.
Request timed out.

Ping statistics for ${displayTarget}:
    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),`
      };
    }

    return {
      delayMs: 120,
      output: `
Pinging ${displayTarget} with 32 bytes of data:
Reply from ${displayTarget}: bytes=32 time=2ms TTL=63
Reply from ${displayTarget}: bytes=32 time=1ms TTL=63
Reply from ${displayTarget}: bytes=32 time=2ms TTL=63
Reply from ${displayTarget}: bytes=32 time=1ms TTL=63

Ping statistics for ${displayTarget}:
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 1ms, Maximum = 2ms, Average = 1ms`
    };
  }

  if (lower === 'tracert') {
    const target = args.find((a: string) => !a.startsWith('-')) || '';
    if (!target) return { output: 'Usage: tracert target_name' };
    const displayTarget =
      ctx.windowRole === 'employee' && /^10\.10\.0\.3[012]$/.test(target)
        ? 'restricted-subnet-host'
        : target;

    if (ctx.windowRole === 'employee' && target.startsWith('10.10.0.') && target !== '10.10.0.100') {
      return {
        delayMs: 180,
        output: `
Tracing route to ${displayTarget} over a maximum of 30 hops

  1     1 ms     1 ms     1 ms  corp-gw.yotta.lab [192.168.1.1]
  2     *        *        *     Request timed out.
  3     *        *        *     Request timed out.
  4     *        *        *     Request timed out.

Trace complete.`
      };
    }

    return {
      delayMs: 120,
      output: `
Tracing route to ${displayTarget} over a maximum of 30 hops

  1     1 ms     1 ms     1 ms  corp-gw.yotta.lab [192.168.1.1]
  2     2 ms     2 ms     2 ms  ${displayTarget}

Trace complete.`
    };
  }

  return null;
}