(function() {

  const vaccinesCsvUrl = 'https://raw.githubusercontent.com/minhealthnz/nz-covid-data/main/vaccine-data/latest/doses_by_date.csv';
  const populationCsvUrl = 'https://raw.githubusercontent.com/minhealthnz/nz-covid-data/main/vaccine-data/latest/tla.csv';
  const regressionDays = 7;
  const targetProportion = 0.9;

  function addDays(date, days) {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + days);
    return newDate;
  }

  function daysBetween(dateA, dateB) {
    // Divide MS difference by MS per day
    return Math.floor((dateB - dateA) / (1000 * 60 * 60 * 24));
  }

  function getVaccineStats() {
    const vaccinesPromise = new Promise(resolve => {
      Papa.parse(vaccinesCsvUrl, {
        download: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        transformHeader: function (header) {
          switch (header) {
          case 'Date':
            return 'date';
          case 'First dose administered':
            return 'first_doses';
          case 'Second dose administered':
            return 'second_doses';
          default:
            return header;
          }
        },
        complete: (result => {
          const vaccineRows = result.data;

          // Add cumulative totals to each row.
          let firstDoseTotal = 0;
          let secondDoseTotal = 0;
          vaccineRows.forEach(function(row) {
            firstDoseTotal += row['first_doses'];
            row['total_first_doses'] = firstDoseTotal;
            secondDoseTotal += row['second_doses'];
            row['total_second_doses'] = secondDoseTotal;
          });

          resolve({ vaccineRows, firstDoseTotal, secondDoseTotal });
        })
      });
    });
    const populationPromise = new Promise(resolve => {
      Papa.parse(populationCsvUrl, {
        download: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        transformHeader: function (header) {
          switch (header) {
          case 'Territorial Authority':
            return 'region';
          case 'Population':
            return 'population';
          default:
            return header;
          }
        },
        complete: (result => {
          const populationRows = result.data;
          const totalPopulationRow = populationRows.find(row => row['region'] == 'Grand Total')
          const population = parseInt(totalPopulationRow['population'].replaceAll(',', ''));
          resolve(population);
        })
      });
    });

    return Promise.all([vaccinesPromise, populationPromise])
      .then(([vaccineData, population]) => {
        const { vaccineRows, firstDoseTotal, secondDoseTotal } = vaccineData;
        const latestRow = vaccineRows[vaccineRows.length - 1]
        const firstDosesProportion = latestRow['total_first_doses'] / population;
        const secondDosesProportion = latestRow['total_second_doses'] / population;
        const targetDoses = population * targetProportion;
        const latestDate = new Date(latestRow['date']);
        const daysUntilNow = daysBetween(latestDate, new Date(Date.now()));

        // Find the mean daily first doses over the last regressionDays.
        const regressionFirstTotal = vaccineRows
              .slice(-regressionDays)
              .reduce(((sum, row) => sum + row['first_doses']), 0);
        const regressionFirstDailyMean = regressionFirstTotal / regressionDays;
        const dailyFirstDoses = Math.round(regressionFirstDailyMean);
        const daysUntilFirstDoseTarget = Math.ceil(Math.max(0, targetDoses - firstDoseTotal) / dailyFirstDoses);

        const firstEndRow = vaccineRows.find(row => row['total_first_doses'] >= targetDoses);
        const firstEndDate = (firstEndRow
                              ? (new Date(firstEndRow['date']))
                              : addDays(latestDate, daysUntilFirstDoseTarget));

        // Find the first day first doses exceeded the current second
        // dose total (because the index is one less than the day
        // represented by it, this is the count of the day before it was
        // exceeded).
        const indexFirstExceededCurrentSecond =  vaccineRows.findIndex(
          row => row['total_first_doses'] > secondDoseTotal);
        // Find the number of days it took for second doses to catch up.
        const secondDoseLagDays = vaccineRows.length - indexFirstExceededCurrentSecond;
        const daysUntilSecondDoseTarget = daysUntilFirstDoseTarget + secondDoseLagDays;

        const secondEndRow = vaccineRows.find(row => row['total_second_doses'] >= targetDoses);
        const secondEndDate = (secondEndRow
                               ? (new Date(secondEndRow['date']))
                               : addDays(firstEndDate, secondDoseLagDays));

        return {
          firstEndDate,
          secondEndDate,
          daysUntilFirstDoseTarget: daysUntilFirstDoseTarget - daysUntilNow,
          daysUntilSecondDoseTarget: daysUntilSecondDoseTarget - daysUntilNow,
          dailyFirstDoses,
          secondDoseLagDays,
          targetProportion,
          firstDosesProportion,
          secondDosesProportion,
        }
      });
  }

  window.vaccines = { getVaccineStats };

})();
