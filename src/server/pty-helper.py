#!/usr/bin/env python3
"""
PTY helper for Hermes Switch UI terminal.
Spawns a real PTY process and bridges stdin/stdout.
Usage: python3 pty-helper.py [cwd] [cols] [rows] -- [command arg1 arg2 ...]
If no command is provided, falls back to an interactive shell.
"""
import sys, os, pty, select, signal, struct, fcntl, termios, json

def set_winsize(fd, rows, cols):
    s = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, s)

def main():
    default_shell = '/bin/zsh' if sys.platform == 'darwin' else '/bin/bash'

    cwd = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('HOME', '/tmp')
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 80
    rows = int(sys.argv[3]) if len(sys.argv) > 3 else 24

    command = None
    if '--' in sys.argv[4:]:
        idx = sys.argv.index('--', 4)
        tail = sys.argv[idx + 1:]
        if tail:
            command = tail

    if command is None:
        shell = os.environ.get('SHELL', default_shell)
        command = [shell, '-i']

    if cwd.startswith('~'):
        cwd = os.path.expanduser(cwd)

    # Create PTY
    master_fd, slave_fd = pty.openpty()
    set_winsize(master_fd, rows, cols)

    pid = os.fork()
    if pid == 0:
        # Child: become session leader, set controlling terminal
        os.setsid()
        os.close(master_fd)

        # Set slave as controlling terminal
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)

        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)

        os.chdir(cwd)
        os.environ['TERM'] = 'xterm-256color'
        os.environ['COLORTERM'] = 'truecolor'
        os.execvp(command[0], command)
    else:
        # Parent: bridge stdin <-> master_fd <-> stdout
        os.close(slave_fd)

        # fd 3 is a line-delimited control channel. It deliberately stays
        # separate from terminal stdin so resize commands cannot become shell
        # input.
        import io
        stdin_fd = sys.stdin.fileno()
        stdout_fd = sys.stdout.fileno()
        control_fd = 3
        control_buffer = b''

        # Set stdout to binary/unbuffered
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, write_through=True)

        try:
            while True:
                read_fds = [master_fd, stdin_fd]
                if control_fd >= 0:
                    read_fds.append(control_fd)
                rlist, _, _ = select.select(read_fds, [], [], 1.0)
                
                if master_fd in rlist:
                    try:
                        data = os.read(master_fd, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    os.write(stdout_fd, data)

                if stdin_fd in rlist:
                    try:
                        data = os.read(stdin_fd, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    os.write(master_fd, data)

                if control_fd in rlist:
                    data = os.read(control_fd, 4096)
                    if not data:
                        control_fd = -1
                    else:
                        control_buffer += data
                        while b'\n' in control_buffer:
                            line, control_buffer = control_buffer.split(b'\n', 1)
                            try:
                                message = json.loads(line)
                                if message.get('type') == 'resize':
                                    new_cols = int(message['cols'])
                                    new_rows = int(message['rows'])
                                    if new_cols > 0 and new_rows > 0:
                                        set_winsize(master_fd, new_rows, new_cols)
                                        os.kill(pid, signal.SIGWINCH)
                            except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                                pass
        except (IOError, OSError):
            pass
        finally:
            os.close(master_fd)
            try:
                os.kill(pid, signal.SIGTERM)
                os.waitpid(pid, 0)
            except:
                pass

if __name__ == '__main__':
    main()
