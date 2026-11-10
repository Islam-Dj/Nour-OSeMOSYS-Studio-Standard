/* Meaning of every result of the master model (variables of the model file, results computed in the model, results
   derived by the Studio as MUIO does). One line per result: [group, meaning, unit]. Units: capacity in the capacity unit
   of the technology (GW in the examples), activity and energy in PJ, money in M$ (the model's currency), emissions in Mt.
   Read by results.js (labels, groups, tooltips) and by the parameter reference (docs/reference: chapter "Results").
   The object below is plain JSON. */
const VDESC = {
"NewCapacity": [
"Capacity",
"New capacity built in the year (decision of the model).",
"capacity"
],
"AccumulatedNewCapacity": [
"Capacity",
"New capacity built in earlier years and still within its life.",
"capacity"
],
"TotalCapacityAnnual": [
"Capacity",
"Total capacity in the year: residual + accumulated new capacity (+ refurbished, - retired).",
"capacity"
],
"NumberOfNewTechnologyUnits": [
"Capacity",
"Number of new units built (integer when CapacityOfOneTechnologyUnit > 0).",
"units"
],
"RateOfActivity": [
"Activity",
"Activity rate of a technology in a mode and time slice (per year of that slice).",
"PJ/yr"
],
"RateOfTotalActivity": [
"Activity",
"Activity rate of a technology in a time slice, all modes.",
"PJ/yr"
],
"TotalAnnualTechnologyActivityByMode": [
"Activity",
"Activity of a technology in a mode over the year.",
"PJ"
],
"TotalTechnologyAnnualActivity": [
"Activity",
"Activity of a technology over the year, all modes.",
"PJ"
],
"TotalTechnologyModelPeriodActivity": [
"Activity",
"Activity of a technology over the whole horizon.",
"PJ"
],
"ProductionByTechnology": [
"Production and use",
"Production of a commodity by a technology in a time slice (energy of the slice).",
"PJ"
],
"ProductionByTechnologyAnnual": [
"Production and use",
"Production of a commodity by a technology over the year.",
"PJ"
],
"ProductionByTechnologyByMode": [
"Production and use",
"Production of a commodity by a technology and mode over the year (derived).",
"PJ"
],
"ProductionByTechnologyByModeTs": [
"Production and use",
"Production by technology, mode and time slice (derived).",
"PJ"
],
"RateOfProductionByTechnologyByMode": [
"Production and use",
"Production rate by technology, mode and time slice (derived).",
"PJ/yr"
],
"UseByTechnology": [
"Production and use",
"Use of a commodity by a technology in a time slice (derived).",
"PJ"
],
"UseByTechnologyAnnual": [
"Production and use",
"Use of a commodity by a technology over the year.",
"PJ"
],
"UseByTechnologyByMode": [
"Production and use",
"Use by technology and mode over the year (derived).",
"PJ"
],
"UseByTechnologyByModeTs": [
"Production and use",
"Use by technology, mode and time slice (derived).",
"PJ"
],
"RateOfUseByTechnologyByMode": [
"Production and use",
"Use rate by technology, mode and time slice (derived).",
"PJ/yr"
],
"Demand": [
"Production and use",
"Demand met in a time slice (SpecifiedAnnualDemand x profile).",
"PJ"
],
"InputToNewCapacity": [
"Production and use",
"Commodity used to build new capacity (InputToNewCapacityRatio).",
"PJ"
],
"InputToTotalCapacity": [
"Production and use",
"Commodity used per unit of installed capacity (InputToTotalCapacityRatio).",
"PJ"
],
"Trade": [
"Trade and valuation",
"Free trade from region r to region rr in a time slice (TradeRoute).",
"PJ/yr"
],
"CapitalInvestment": [
"Costs",
"Overnight capital spending on new capacity: CapitalCost x NewCapacity.",
"M$"
],
"AnnualizedInvestmentCost": [
"Costs",
"Capital spending spread over the life with the capital recovery factor (derived, as MUIO).",
"M$"
],
"AnnualFixedOperatingCost": [
"Costs",
"Fixed cost: FixedCost x total capacity.",
"M$"
],
"AnnualVariableOperatingCost": [
"Costs",
"Variable cost: VariableCost x activity.",
"M$"
],
"SalvageValue": [
"Costs",
"Value left at the end of the horizon of capacity built in the year.",
"M$"
],
"DiscountedSalvageValue": [
"Costs",
"Salvage value discounted to the first year (subtracted in the objective).",
"M$"
],
"TechnologyEmissionsPenalty": [
"Costs",
"Emission penalty paid by a technology: EmissionsPenalty x its emissions.",
"M$"
],
"AnnualTechnologyEmission": [
"Emissions",
"Emissions of a technology over the year.",
"Mt"
],
"AnnualTechnologyEmissionByMode": [
"Emissions",
"Emissions of a technology in a mode over the year.",
"Mt"
],
"AnnualEmissions": [
"Emissions",
"Emissions of the region over the year, all technologies.",
"Mt"
],
"EmissionByActivityChange": [
"Emissions",
"Emissions from changes of activity (EmissionToActivityChangeRatio).",
"Mt"
],
"NewStorageCapacity": [
"Storage",
"New energy capacity of a storage built in the year.",
"PJ"
],
"AccumulatedNewStorageCapacity": [
"Storage",
"New storage capacity built in earlier years and still within its life.",
"PJ"
],
"TotalStorageCapacity": [
"Storage",
"Total energy capacity of a storage: residual + new still in life.",
"PJ"
],
"CapitalInvestmentStorage": [
"Storage",
"Capital spending on new storage capacity.",
"M$"
],
"DiscountedCapitalInvestmentStorage": [
"Storage",
"Storage capital spending discounted to the first year.",
"M$"
],
"SalvageValueStorage": [
"Storage",
"Value left of storage capacity at the end of the horizon.",
"M$"
],
"DiscountedSalvageValueStorage": [
"Storage",
"Storage salvage value discounted to the first year.",
"M$"
],
"TotalDiscountedStorageCost": [
"Storage",
"Discounted cost of a storage in the year.",
"M$"
],
"StorageLevelYearStart": [
"Storage",
"Level of a storage at the start of the year (day-type storage equations).",
"PJ"
],
"StorageLevelYearFinish": [
"Storage",
"Level of a storage at the end of the year (day-type storage equations).",
"PJ"
],
"StorageLevelSeasonStart": [
"Storage",
"Level at the start of a season (day-type storage equations).",
"PJ"
],
"StorageLevelDayTypeStart": [
"Storage",
"Level at the start of a day type (day-type storage equations).",
"PJ"
],
"StorageLevelDayTypeFinish": [
"Storage",
"Level at the end of a day type (day-type storage equations).",
"PJ"
],
"RateOfNetStorageActivity": [
"Storage",
"Net charge rate (charge - discharge) in a daily time bracket (day-type storage equations).",
"PJ/yr"
],
"NetChargeWithinYear": [
"Storage",
"Net charge accumulated within the year (day-type storage equations).",
"PJ"
],
"NetChargeWithinDay": [
"Storage",
"Net charge accumulated within the day (day-type storage equations).",
"PJ"
],
"StorageLowerLimit": [
"Storage",
"Lowest allowed level: MinStorageCharge x capacity.",
"PJ"
],
"StorageUpperLimit": [
"Storage",
"Highest allowed level: the capacity.",
"PJ"
],
"ProductionByTechnologyByVintage": [
"Vintaging",
"Production of a commodity by each cohort (vintage) of a technology over the year, with its vintage and age factors; the cohorts add up to ProductionByTechnologyAnnual (derived) [2].",
"PJ"
],
"UseByTechnologyByVintage": [
"Vintaging",
"Use of a commodity by each cohort of a technology over the year (fuel use of old and new plants); adds up to UseByTechnologyAnnual (derived) [2].",
"PJ"
],
"AnnualTechnologyEmissionByVintage": [
"Vintaging",
"Emissions of each cohort of a technology over the year; adds up to AnnualTechnologyEmission (derived) [2].",
"Mt"
],
"TechnologyActivityTS": [
"Activity",
"Activity of a technology in each time slice (rate × YearSplit). Group it by season, day type or day part to see how the year is shared.",
"unit of activity"
],
"StorageChargeTS": [
"Storage",
"Energy (or water...) put into a storage in each time slice, by the technologies that charge it. Its sum over the slices is StorageChargeAnnual.",
"unit of the storage"
],
"StorageDischargeTS": [
"Storage",
"Energy (or water...) taken out of a storage in each time slice, by the technologies that discharge it. Its sum over the slices is StorageDischargeAnnual.",
"unit of the storage"
],
"AnnualTechnologyEmissionTS": [
"Emissions",
"Emissions of a technology in each time slice. Its sum over the slices is AnnualTechnologyEmission.",
"unit of the emission"
]
};
// a short title for each index set, shown next to the field (Rows / Columns / filters)
const SETDESC_RES = {"REGION": "region", "TECHNOLOGY": "technology", "COMMODITY": "commodity", "EMISSION": "emission", "STORAGE": "storage",
  "YEAR": "year", "TIMESLICE": "time slice", "MODE_OF_OPERATION": "mode", "SEASON": "season", "DAYTYPE": "day type",
  "DAILYTIMEBRACKET": "daily time bracket", "UDC": "user constraint", "VINTAGE": "vintage (build year of a cohort)", "AGE": "age",
  "FINANCE": "finance source", "TSGROUP": "group of time slices (typical day / week)", "REGION 2": "second region (trade partner)", "YSTAGE": "crop stage (1 initial, 2 development, 3 mid-season, 4 late season)"};
