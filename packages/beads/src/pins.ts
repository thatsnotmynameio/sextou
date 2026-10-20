// The bd and Dolt releases sextou runs, with their checksums. Each hash was
// computed from the downloaded file; each archive hash matches beads'
// checksums.txt, or GitHub's asset digest for Dolt, which publishes no
// checksums file. They are never fetched at run time. Dolt 2.2.0 is the
// version beads 1.3.1 tests against.

// A platform as `${process.platform}-${process.arch}`. Windows arm64 is
// missing because Dolt publishes no build for it.
export type PlatformKey =
  | 'linux-x64'
  | 'linux-arm64'
  | 'darwin-x64'
  | 'darwin-arm64'
  | 'win32-x64';

export interface Release {
  // An https URL to the archive.
  url: string;
  archiveSha256: string;
  // The binary's path inside the archive, with forward slashes.
  binary: string;
  binarySha256: string;
}

export interface Pin {
  // The tool's name in messages.
  name: string;
  version: string;
  releases: Partial<Record<PlatformKey, Release>>;
}

export interface Pins {
  bd: Pin;
  dolt: Pin;
}

const beads = 'https://github.com/gastownhall/beads/releases/download/v1.3.1';
const dolt = 'https://github.com/dolthub/dolt/releases/download/v2.2.0';

export const pins: Pins = {
  bd: {
    name: 'bd',
    version: '1.3.1',
    releases: {
      'linux-x64': {
        url: `${beads}/beads_1.3.1_linux_amd64.tar.gz`,
        archiveSha256:
          '3219443a9734b89b93fb16ee8d65844759fa1b3cd3cf139c606b7353cfb0715c',
        binary: 'bd',
        binarySha256:
          'a8f48d771b9e11eccfced4aed72923b59eda746f7a9b425e7ca1af7a51251653',
      },
      'linux-arm64': {
        url: `${beads}/beads_1.3.1_linux_arm64.tar.gz`,
        archiveSha256:
          'c3b32c71a6c0cd6358a12c28272b17e6818db991da192f87df52339c222e423a',
        binary: 'bd',
        binarySha256:
          '213518569a3648c1a520bced38733a08c66b693c53aa8801f49c644de0a44330',
      },
      'darwin-x64': {
        url: `${beads}/beads_1.3.1_darwin_amd64.tar.gz`,
        archiveSha256:
          '13bddb0b4774503d97d57e94204acc2b7c6b775fecc22fa38bc1b831718e234d',
        binary: 'bd',
        binarySha256:
          'dc8728941531c3306dbc35336b9b391401b1b16d6f6f339111640ea7ee353823',
      },
      'darwin-arm64': {
        url: `${beads}/beads_1.3.1_darwin_arm64.tar.gz`,
        archiveSha256:
          '508ba807996e2b9c992c538a6f405f2fc7d2e16cf8b4e5b0d1bf9fe860367007',
        binary: 'bd',
        binarySha256:
          'c06a59fda589d1fc00e394027ee90992d5083aea487c301c9e9eaf592e22e8b4',
      },
      'win32-x64': {
        url: `${beads}/beads_1.3.1_windows_amd64.zip`,
        archiveSha256:
          '48cd82e1d3e311c9bf9a5d6d67ad1a8542ae13d4e20c5bfb527656c5e666af76',
        binary: 'bd.exe',
        binarySha256:
          'ac5b60114e5e7ef9de8878b45fc35941937341d3447366c99bc91c81557be7a4',
      },
    },
  },
  dolt: {
    name: 'Dolt',
    version: '2.2.0',
    releases: {
      'linux-x64': {
        url: `${dolt}/dolt-linux-amd64.tar.gz`,
        archiveSha256:
          '1f7ad8c2622995789420a3fb0f2d16b4aa7430000a825dd91d5938f36480cbf6',
        binary: 'dolt-linux-amd64/bin/dolt',
        binarySha256:
          '72352f1d882472a7a8d6124e9c4dc12f80e2c2359ea95f1424c032e9250e35e6',
      },
      'linux-arm64': {
        url: `${dolt}/dolt-linux-arm64.tar.gz`,
        archiveSha256:
          'a49a566d7c1ee9fdff553644855737f9d87047557c1ce1951aa7e7053277f4af',
        binary: 'dolt-linux-arm64/bin/dolt',
        binarySha256:
          '54fc2bb6cf02fef77ccc4ba61298ae41c5f31eed58df34d885330a394e8da028',
      },
      'darwin-x64': {
        url: `${dolt}/dolt-darwin-amd64.tar.gz`,
        archiveSha256:
          'd40b57933e2a2c025a5a3c269eb87594b1aa71ead16c9902213d521529a19b02',
        binary: 'dolt-darwin-amd64/bin/dolt',
        binarySha256:
          'cfd10e8988601400ca56950b6caf6eff209feac03e41e9d46dd6caf4d1af301c',
      },
      'darwin-arm64': {
        url: `${dolt}/dolt-darwin-arm64.tar.gz`,
        archiveSha256:
          'c6737dc2c5806e2eeef4839ad76c28167c861f878af3071df1242a6589d81267',
        binary: 'dolt-darwin-arm64/bin/dolt',
        binarySha256:
          '2c775333f7085821e95136d2066fa3d63e0926087b4b6878f68d0a4d78343690',
      },
      'win32-x64': {
        url: `${dolt}/dolt-windows-amd64.zip`,
        archiveSha256:
          '7a4be662d5548bc63ae4ab6d8d93daa2a6681f3e076817908ac4a08d782eb6f6',
        binary: 'dolt-windows-amd64/bin/dolt.exe',
        binarySha256:
          'bed880c0e6b522498a563fcd1f0fc1e25527ba07e66c1e0a85c2242b64dfd967',
      },
    },
  },
};
