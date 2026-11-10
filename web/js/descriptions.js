'use strict';
/* ============================== descriptions ============================== */
const TD0 = {};
const FD0 = {};
const PD = {
  CapitalCost: [
    'Costs',
    'Capital cost per unit of new capacity (M$ per capacity unit; with CapacityToActivityUnit 31.536 the unit is GW, so M$/GW = $/kW).'
  ],
  FixedCost: ['Costs', 'Fixed O&M cost per unit of capacity and year.'],
  VariableCost: ['Costs', 'Variable cost per unit of activity, by mode ($/GJ = M$/PJ).'],
  ResidualCapacity: ['Capacity', 'Existing capacity (no capital cost).'],
  TotalAnnualMaxCapacity: ['Capacity', 'Maximum total installed capacity in a year.'],
  TotalAnnualMinCapacity: ['Capacity', 'Minimum total installed capacity.'],
  TotalAnnualMaxCapacityInvestment: ['Capacity', 'Maximum new capacity per year (build rate).'],
  TotalAnnualMinCapacityInvestment: ['Capacity', 'Minimum new capacity per year.'],
  TotalTechnologyAnnualActivityUpperLimit: ['Activity limits', 'Maximum activity per year (PJ).'],
  TotalTechnologyAnnualActivityLowerLimit: ['Activity limits', 'Minimum activity per year (calibration pins 2022-24).'],
  TotalTechnologyModelPeriodActivityUpperLimit: ['Activity limits', 'Maximum activity over 2022-2070 (finite resource).'],
  TotalTechnologyModelPeriodActivityLowerLimit: ['Activity limits', 'Minimum activity over the horizon.'],
  TechnologyActivityByModeUpperLimit: ['Activity limits', 'Maximum activity of one mode (0 = no limit in this model code).'],
  TechnologyActivityByModeLowerLimit: ['Activity limits', 'Minimum activity of one mode.'],
  TechnologyActivityIncreaseByModeLimit: ['Activity limits', 'Maximum yearly increase of a mode.'],
  TechnologyActivityDecreaseByModeLimit: ['Activity limits', 'Maximum yearly decrease of a mode.'],
  InputActivityRatio: ['Conversion', 'Input per unit of activity, by commodity and mode.'],
  OutputActivityRatio: ['Conversion', 'Output per unit of activity, by commodity and mode.'],
  CapacityFactor: ['Performance', 'Share of capacity available in each time slice.'],
  AvailabilityFactor: ['Performance', 'Share of the year the capacity is available.'],
  OperationalLife: ['Performance', 'Lifetime (years).'],
  CapacityToActivityUnit: ['Performance', 'Activity (PJ) per unit of capacity per year (31.536 = GW).'],
  DiscountRateIdv: ['Performance', 'Technology discount rate (capital recovery).'],
  EmissionActivityRatio: ['Emissions', 'Emission per unit of activity (Mt CO2 per PJ).'],
  EmissionsPenalty: ['Emissions', 'Emission penalty.'],
  UDCMultiplierActivity: ['User constraints', 'Coefficient on the activity in a user-defined constraint.'],
  UDCMultiplierTotalCapacity: ['User constraints', 'Coefficient on total capacity in a user-defined constraint.'],
  UDCMultiplierNewCapacity: ['User constraints', 'Coefficient on new capacity in a user-defined constraint.'],
  TechnologyToStorage: ['Storage', 'Charging link to a storage, by mode.'],
  TechnologyFromStorage: ['Storage', 'Discharging link from a storage, by mode.'],
  CapacityOfOneTechnologyUnit: ['Capacity', 'Unit size (integer builds).'],
  InputToNewCapacityRatio: ['Conversion', 'Input needed per unit of new capacity.'],
  InputToTotalCapacityRatio: ['Conversion', 'Input needed per unit of total capacity.']
};
/* Studio: labels of the result variables computed in the master model */
const VLAB = {
  ExportRent: 'ExportRent · export margin',
  ExportRevenue: 'ExportRevenue · gross export revenue',
  NetExports: 'NetExports · trade balance (export revenue - import payments)',
  ExportMarginByTechnology: 'ExportMarginByTechnology · export margin by technology',
  ProductionByTechnologyAnnual: 'ProductionByTechnologyAnnual (computed in the model)',
  UseByTechnologyAnnual: 'UseByTechnologyAnnual (computed in the model)',
  ProductionAnnual: 'ProductionAnnual · all technologies',
  UseAnnual: 'UseAnnual · all technologies',
  AnnualEmissions: 'AnnualEmissions (computed in the model)',
  TotalStorageCapacity: 'TotalStorageCapacity (computed in the model)',
  StorageChargeAnnual: 'StorageChargeAnnual · energy charged',
  StorageDischargeAnnual: 'StorageDischargeAnnual · energy discharged',
  ModelPeriodCostByRegion: 'ModelPeriodCostByRegion · discounted cost 2022-end',
  TotalCapacityByVintage: 'TotalCapacityByVintage · capacity of each cohort',
  AnnualActivityByVintage: 'AnnualActivityByVintage · activity of each cohort',
  RetireByVintage: 'RetireByVintage · capacity retired early (by cohort, year)',
  RetiredCapacity: 'RetiredCapacity · retired early, still within its life',
  RefurbishedCapacity: 'RefurbishedCapacity · refurbished in the year',
  RefurbByVintage: 'RefurbByVintage · cohort refurbished at the end of its life',
  RateOfActivityByVintage: 'RateOfActivityByVintage · cohort activity by time slice',
  StorageLevelTS: 'StorageLevelTS · level at the end of the time slice',
  StorageGroupStart: 'StorageGroupStart · level at the start of the group',
  StorageSpill: 'StorageSpill · inflow spilled',
  FinanceUse: 'FinanceUse · money of each source by technology',
  FinanceUseStorage: 'FinanceUseStorage · money of each source by storage',
  FinanceRaised: 'FinanceRaised · money of each source',
  FinanceService: 'FinanceService · yearly repayment',
  RefurbishmentInvestment: 'RefurbishmentInvestment · spending on refurbishment'
};
const GROUPS = [
  'Conversion',
  'Costs',
  'Capacity',
  'Activity limits',
  'Performance',
  'Operation',
  'Water and land',
  'Trade and prices',
  'Emissions',
  'User constraints',
  'Storage',
  'Finance',
  'Time',
  'Other'
];
let TD = {},
  FD = {}; // active descriptions: those of the data file, plus any CSV loaded
const NONTECH = new Set([
  'SpecifiedAnnualDemand',
  'AccumulatedAnnualDemand',
  'SpecifiedDemandProfile',
  'TradeRoute',
  'EmissionsPenalty',
  'AnnualEmissionLimit',
  'ModelPeriodEmissionLimit',
  'ModelPeriodExogenousEmission',
  'AnnualExogenousEmission',
  'UDCConstant',
  'UDCTag',
  'OperationalLifeStorage',
  'StorageLevelStart',
  'CapitalCostStorage',
  'ResidualStorageCapacity',
  'MinStorageCharge',
  'StorageMaxChargeRate',
  'StorageMaxDischargeRate',
  'DiscountRate',
  'DiscountRateStorage',
  'YearSplit',
  'DaySplit',
  'DaysInDayType',
  'Conversionls',
  'Conversionld',
  'Conversionlh',
  'ReserveMargin',
  'REMinProductionTarget',
  'ReserveMarginTagFuel',
  'RETagFuel',
  'DepreciationMethod'
]);
let REG = []; // from set REGION of the loaded file
const RNAME0 = {};
let SETDESC = {}; // descriptions of set members: {SEASON: {'1': 'Winter'}, TIMESLICE: {...}, REGION: {...}}
const RNAME = new Proxy(RNAME0, {get: (o, k) => (SETDESC.REGION && SETDESC.REGION[k]) || o[k] || k});
const sdesc = (set, m) => (SETDESC[set] && SETDESC[set][m]) || '';
let KEYY = []; // first, last and every 5th year of the loaded file
