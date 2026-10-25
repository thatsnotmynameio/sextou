// The Taskfile every claim points at until tasks carry their own: this
// repository's tasks/hello-world, which prints hello world with Python, then
// runs for 2 seconds.
export const stubSource = {
  repo: 'thatsnotmynameio/sextou',
  // The commit on main that added tasks/hello-world (#79).
  sha: '87dfc7f4f839d6e334ab1a1cdf6494c62499d9ff',
  taskfile: 'tasks/hello-world/Taskfile.yml',
};
