// The Taskfile every claim answers until tasks carry their own: its default
// task writes a line and runs for 2 seconds, long enough for a heartbeat to
// say someone asked to cancel it.
export const stubTaskfile = `version: '3'
tasks:
  default:
    cmds:
      - echo "sextou stub"
      - sleep 2
`;
