# ENSOscope

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23366523.svg)](https://doi.org/10.5281/zenodo.23366523)

ENSOscope shows what El Niño and La Niña are likely to do next, and what they have done before, for 89 countries most exposed to them. It is built for humanitarian teams who need to plan ahead.

Website: https://iadicarlo.org/ensoscope/

## What is here

This repository holds the published website and the data it shows:

- the ENSO forecast: the chance of El Niño and La Niña from ECMWF (SEAS5) and Météo-France (System 9), for the month of issue and the five after it, updated every month
- how well those forecasts have done in the past
- maps of how past El Niño and La Niña events changed rainfall (observed, CHIRPS) and heat (ERA5 reanalysis) worldwide, with a panel per country setting each month of the ENSO forecast beside what past events of that class did there, naming those events
- an event replay: any past El Niño or La Niña, month by month, for each country, with a timeline of the floods, droughts, heat waves and disease outbreaks recorded at the time
- a regional forecast for the next six months, region by region, from the same two forecast models corrected against the observed record: rain, dry days, maximum temperature, heat-stress days and warm nights, each with how well the model did in the past
- two downloads per country: a One-page summary (PDF and Excel) for hospital and field teams, in English and, where the country works in it, French, Spanish or Portuguese; and a Full analysis (PDF and Excel) for analysts, with this El Niño month by month against every past one, for the country and each region, the regional forecast with its skill, the outbreak record and a methods annex

The outbreak records from sources that allow it are in data/archive/, with a note on how to credit each source. The rest of the outbreak and disaster records are shown on the site but kept out of the archived releases until their owners agree.

The data processing code is kept in a separate repository.

## Updates and versions

The site is updated every month when the new forecasts come out. Each update is published as a release here, and each release is archived on Zenodo with its own DOI, so a given version can always be found and cited.

## How to cite

Abdelkader Di Carlo, I. (2026). ENSOscope: seasonal El Niño and La Niña forecasts and impacts for humanitarian anticipatory action. Zenodo. https://doi.org/10.5281/zenodo.23366523

This DOI always points to the latest version. Each monthly version also has its own DOI, listed on the Zenodo page.

Please also cite the datasets ENSOscope builds on. They are listed, with their own licences and references, on the methodology page: https://iadicarlo.org/ensoscope/methodology.html#data-sources

## Licence

Original ENSOscope content is shared under CC BY 4.0. Third-party data keeps its own licence. See LICENSE.

## Contact

Isma Abdelkader Di Carlo, Utrecht University
