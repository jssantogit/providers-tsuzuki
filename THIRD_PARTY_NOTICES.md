# Third-party notices

## MangaFire reference Provider

Parts of `providers/mangafire/` were adapted with reference to the MangaFire extension in [`keiyoushi/extensions-source`](https://github.com/keiyoushi/extensions-source/tree/main/src/all/mangafire), especially the current API request flow, response-field mapping, and VRF signing algorithm/constants.

The referenced project carries the notice **Copyright 2015 Javier Tomás** and is licensed under the **Apache License, Version 2.0**. Tsuzuki's implementation has been substantially modified for the Provider Platform's JavaScript sandbox, typed Provider DTOs, and host-mediated network/browser services.

A copy of Apache-2.0 is stored at [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt) and is bundled inside the published MangaFire `.tsz` artifact.
