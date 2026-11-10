"""Monte Carlo catalogue of Nour OSeMOSYS Studio: 43 probability distributions and 11 stochastic differential equations.

Every distribution is given as a frozen object with ppf (quantile), pdf / pmf, mean, support, so it can be sampled by inverse
transform (plain Monte Carlo, Latin hypercube, Halton, Sobol and Gaussian-copula correlation all work the same way).
Values are usually MULTIPLIERS of the base value (1 = the base), but a factor can also be absolute, additive or in %.
"""

import math
import numpy as np
from scipy import stats as st
from scipy import special as sp


# --------------------------------------------------------------------------- helpers
class Custom:
    """distribution given by its quantile function (and optionally pdf)"""

    def __init__(self, ppf, pdf=None, lo=-np.inf, hi=np.inf, mean=None, discrete=False):
        self._ppf, self._pdf, self.lo, self.hi, self._mean, self.discrete = ppf, pdf, lo, hi, mean, discrete

    def ppf(self, u):
        return self._ppf(np.clip(np.asarray(u, float), 1e-12, 1 - 1e-12))

    def pdf(self, x):
        return self._pdf(np.asarray(x, float)) if self._pdf else None

    def mean(self):
        if self._mean is not None:
            return self._mean
        u = (np.arange(20000) + 0.5) / 20000
        return float(np.mean(self.ppf(u)))

    def support(self):
        return self.lo, self.hi


class Frozen:
    """scipy frozen distribution, with an affine transform value = offset + step * X (discrete counts) and truncation"""

    def __init__(self, d, discrete=False, offset=0.0, step=1.0):
        self.d, self.discrete, self.offset, self.step = d, discrete, offset, step

    def ppf(self, u):
        u = np.clip(np.asarray(u, float), 1e-12, 1 - 1e-12)
        return self.offset + self.step * self.d.ppf(1 - u if self.step < 0 else u)  # always increasing in u (copulas, LHS)

    def pdf(self, x):
        x = np.asarray(x, float)
        if self.discrete:
            return None
        return self.d.pdf((x - self.offset) / self.step) / abs(self.step)

    def pmf(self):
        a, b = self.d.ppf(1e-6), self.d.ppf(1 - 1e-6)
        k = np.arange(int(a), int(b) + 1)
        return self.offset + self.step * k, self.d.pmf(k)

    def mean(self):
        return float(self.offset + self.step * self.d.mean())

    def support(self):
        lo, hi = self.d.support()
        return self.offset + self.step * lo, self.offset + self.step * hi


class Truncated:
    """any distribution restricted to [lo, hi]: u -> ppf(F(lo) + u (F(hi) - F(lo)))"""

    def __init__(self, base, lo, hi):
        self.b, self.lo, self.hi = base, lo, hi
        grid = (np.arange(200001) + 0.5) / 200001  # numeric CDF of the base through its quantiles
        q = base.ppf(grid)
        self._q, self._u = q, grid
        self.ulo = float(np.interp(lo, q, grid, left=0.0, right=1.0)) if np.isfinite(lo) else 0.0
        self.uhi = float(np.interp(hi, q, grid, left=0.0, right=1.0)) if np.isfinite(hi) else 1.0
        self.discrete = getattr(base, 'discrete', False)

    def ppf(self, u):
        return np.clip(self.b.ppf(self.ulo + np.asarray(u, float) * (self.uhi - self.ulo)), self.lo, self.hi)

    def pdf(self, x):
        p = self.b.pdf(x)
        if p is None:
            return None
        x = np.asarray(x, float)
        return np.where((x >= self.lo) & (x <= self.hi), p / max(self.uhi - self.ulo, 1e-12), 0)

    def mean(self):
        u = (np.arange(20000) + 0.5) / 20000
        return float(np.mean(self.ppf(u)))

    def support(self):
        return self.lo, self.hi


def pert(lo, mode, hi, lam=4.0):
    if not lo < hi:
        raise ValueError('min must be below max')
    if not lo <= mode <= hi:
        raise ValueError('the most likely value must be between min and max')
    a = 1 + lam * (mode - lo) / (hi - lo)
    b = 1 + lam * (hi - mode) / (hi - lo)
    return Frozen(st.beta(a, b, loc=lo, scale=hi - lo))


def kumaraswamy(a, b, lo, hi):
    ppf = lambda u: lo + (hi - lo) * (1 - (1 - u) ** (1 / b)) ** (1 / a)

    def pdf(x):
        z = (x - lo) / (hi - lo)
        z = np.clip(z, 1e-12, 1 - 1e-12)
        return np.where((x > lo) & (x < hi), a * b * z ** (a - 1) * (1 - z**a) ** (b - 1) / (hi - lo), 0)

    return Custom(ppf, pdf, lo, hi)


def cumulative(xs, ps):
    xs, ps = np.asarray(xs, float), np.asarray(ps, float)
    if len(xs) < 2 or len(xs) != len(ps):
        raise ValueError('give as many cumulative probabilities as values (at least 2)')
    if np.any(np.diff(xs) <= 0) or np.any(np.diff(ps) < 0):
        raise ValueError('values must increase and probabilities must not decrease')
    ps = (ps - ps[0]) / (ps[-1] - ps[0])

    def pdf(x):
        i = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
        d = (ps[i + 1] - ps[i]) / (xs[i + 1] - xs[i])
        return np.where((x >= xs[0]) & (x <= xs[-1]), d, 0)

    return Custom(lambda u: np.interp(u, ps, xs), pdf, xs[0], xs[-1])


def discrete(values, probs):
    v, p = np.asarray(values, float), np.asarray(probs, float)
    if len(v) != len(p) or len(v) < 1:
        raise ValueError('give one probability per value')
    if np.any(p < 0) or p.sum() <= 0:
        raise ValueError('probabilities must be >= 0')
    o = np.argsort(v)
    v, p = v[o], p[o] / p.sum()
    c = np.cumsum(p)
    d = Custom(
        lambda u: v[np.minimum(np.searchsorted(c, u, side='left'), len(v) - 1)], None, v[0], v[-1], float((v * p).sum()), discrete=True
    )
    d.pmf = lambda: (v, p)
    return d


def numlist(s):
    if isinstance(s, (list, tuple)):
        return [float(x) for x in s]
    return [float(x) for x in str(s).replace(';', ',').replace('\n', ',').split(',') if x.strip()]


# --------------------------------------------------------------------------- the 43 distributions
# key: (name, group, [(param, label, default)], builder, explanation, typical use in energy / CLEWs models)
D = {}


def dist(key, name, group, params, build, explain, use):
    D[key] = {
        'key': key,
        'name': name,
        'group': group,
        'params': [{'k': k, 'label': l, 'default': d} for k, l, d in params],
        'build': build,
        'explain': explain,
        'use': use,
    }


G1, G2, G3, G4, G5 = 'Bounded', 'Unbounded', 'Positive', 'Discrete', 'Empirical'
dist(
    'uniform',
    'Uniform',
    G1,
    [('min', 'Minimum', 0.8), ('max', 'Maximum', 1.2)],
    lambda p: Frozen(st.uniform(p['min'], p['max'] - p['min'])),
    'Every value between the minimum and the maximum is equally likely. The least informative choice when only a range is known.',
    'Policy or deployment ranges with no preferred value; first screening of a parameter.',
)
dist(
    'loguniform',
    'Log-uniform (reciprocal)',
    G1,
    [('min', 'Minimum (> 0)', 0.5), ('max', 'Maximum', 2.0)],
    lambda p: Frozen(st.loguniform(p['min'], p['max'])),
    'Uniform on the logarithm: each factor of 2 (or 10) in the range is equally likely. Gives as much weight to halving as to doubling.',
    'Quantities known only to an order of magnitude: costs of immature technologies (hydrogen, CCS), resource potentials.',
)
dist(
    'triangular',
    'Triangular',
    G1,
    [('min', 'Minimum', 0.8), ('mode', 'Most likely', 1.0), ('max', 'Maximum', 1.3)],
    lambda p: Frozen(st.triang((p['mode'] - p['min']) / (p['max'] - p['min']), loc=p['min'], scale=p['max'] - p['min'])),
    'Minimum, most likely and maximum; probability falls linearly from the most likely value to the bounds. Simple and easy to explain.',
    'Expert ranges of capital costs, efficiencies, build rates; skewed ranges (more upside than downside).',
)


def _trap(p):
    a, b, c, d = p['min'], p['b'], p['c'], p['max']
    if not a <= b <= c <= d or a == d:
        raise ValueError('need min <= start of plateau <= end of plateau <= max')
    return Frozen(st.trapezoid((b - a) / (d - a), (c - a) / (d - a), loc=a, scale=d - a))


dist(
    'trapezoidal',
    'Trapezoidal',
    G1,
    [('min', 'Minimum', 0.7), ('b', 'Plateau from', 0.9), ('c', 'Plateau to', 1.1), ('max', 'Maximum', 1.4)],
    _trap,
    'A flat most-likely range with linear tails: like the triangular, but with a range of equally likely central values.',
    'When experts give a central range rather than a single value (e.g. "costs between 900 and 1100, never below 700 or above 1400").',
)
dist(
    'pert',
    'PERT (Beta-PERT)',
    G1,
    [('min', 'Minimum', 0.8), ('mode', 'Most likely', 1.0), ('max', 'Maximum', 1.4)],
    lambda p: pert(p['min'], p['mode'], p['max'], 4),
    'Smooth version of the triangular (a scaled beta): same three values but less weight in the tails; mean = (min + 4 mode + max) / 6.',
    'The usual choice for expert estimates of costs and durations in project and energy planning.',
)
dist(
    'mpert',
    'Modified PERT',
    G1,
    [('min', 'Minimum', 0.8), ('mode', 'Most likely', 1.0), ('max', 'Maximum', 1.4), ('lam', 'Confidence (4 = PERT)', 4.0)],
    lambda p: pert(p['min'], p['mode'], p['max'], p['lam']),
    'PERT with an adjustable confidence in the most likely value: higher = more peaked, lower = flatter (2 is close to triangular).',
    'Expert estimates where the confidence differs between parameters (well-known vs. new technologies).',
)
dist(
    'beta',
    'Beta (4 parameters)',
    G1,
    [('a', 'Shape alpha', 2.0), ('b', 'Shape beta', 2.0), ('min', 'Minimum', 0.8), ('max', 'Maximum', 1.2)],
    lambda p: Frozen(st.beta(p['a'], p['b'], loc=p['min'], scale=p['max'] - p['min'])),
    'Flexible shape on a finite range: symmetric (alpha = beta), skewed, U-shaped (< 1) or bell-shaped (> 1).',
    'Shares and fractions: capacity factors, availability, efficiencies, losses, market shares, irrigation efficiency.',
)
dist(
    'kumaraswamy',
    'Kumaraswamy',
    G1,
    [('a', 'Shape a', 2.0), ('b', 'Shape b', 3.0), ('min', 'Minimum', 0.8), ('max', 'Maximum', 1.2)],
    lambda p: kumaraswamy(p['a'], p['b'], p['min'], p['max']),
    'Close to the beta but with a closed-form quantile, so sampling is exact and fast.',
    'Bounded hydrological or climatic ratios (runoff coefficients, crop-yield ratios) when a beta-like shape is wanted.',
)
dist(
    'truncnormal',
    'Truncated normal',
    G1,
    [('mean', 'Mean (before truncation)', 1.0), ('sd', 'Standard deviation', 0.1), ('min', 'Minimum', 0.7), ('max', 'Maximum', 1.3)],
    lambda p: Frozen(st.truncnorm((p['min'] - p['mean']) / p['sd'], (p['max'] - p['mean']) / p['sd'], loc=p['mean'], scale=p['sd'])),
    'A normal (bell) curve cut at physical limits, so no impossible values (negative costs, efficiencies above 1).',
    'Measured quantities with known error and hard limits: efficiencies, heat rates, emission factors, yields.',
)
dist(
    'arcsine',
    'Arcsine',
    G1,
    [('min', 'Minimum', 0.8), ('max', 'Maximum', 1.2)],
    lambda p: Frozen(st.arcsine(loc=p['min'], scale=p['max'] - p['min'])),
    'U-shaped: values near the two bounds are the most likely; a beta(0.5, 0.5).',
    'Two-regime situations: a technology either succeeds or fails, a policy is either strong or weak, wet or dry years.',
)
dist(
    'johnsonsb',
    'Johnson SB',
    G1,
    [('gamma', 'Shape gamma', 0.0), ('delta', 'Shape delta', 1.0), ('min', 'Minimum', 0.7), ('max', 'Maximum', 1.3)],
    lambda p: Frozen(st.johnsonsb(p['gamma'], p['delta'], loc=p['min'], scale=p['max'] - p['min'])),
    'A bounded distribution made from a transformed normal; can match any mean, spread, skew and peakedness within the bounds.',
    'Fitting bounded data with unusual shape (e.g. observed capacity factors of a fleet).',
)
dist(
    'raisedcosine',
    'Raised cosine',
    G1,
    [('mu', 'Centre', 1.0), ('s', 'Half-width', 0.2)],
    lambda p: Frozen(st.cosine(loc=p['mu'], scale=p['s'] / math.pi)),
    'A smooth bell on a finite range [centre - half-width, centre + half-width]; looks normal but has no tails.',
    'Symmetric bounded uncertainty without extreme values: seasonal profile shapes, load-shape errors.',
)
dist(
    'power',
    'Power function',
    G1,
    [('alpha', 'Exponent alpha', 2.0), ('min', 'Minimum', 0.8), ('max', 'Maximum', 1.2)],
    lambda p: Frozen(st.powerlaw(p['alpha'], loc=p['min'], scale=p['max'] - p['min'])),
    'Density proportional to (x - min)^(alpha - 1): rising (alpha > 1) or falling (alpha < 1) across the range.',
    'Ranges where values near one bound are favoured (e.g. reaching close to a technical maximum).',
)
dist(
    'normal',
    'Normal (Gaussian)',
    G2,
    [('mean', 'Mean', 1.0), ('sd', 'Standard deviation', 0.1)],
    lambda p: Frozen(st.norm(p['mean'], p['sd'])),
    'The bell curve: symmetric errors from many small independent causes. Unbounded, so it can give negative values: truncate if needed.',
    'Measurement and statistical errors; forecast errors of demand; noise around a trend.',
)
dist(
    'studentt',
    'Student t',
    G2,
    [('df', 'Degrees of freedom', 5.0), ('loc', 'Centre', 1.0), ('scale', 'Scale', 0.1)],
    lambda p: Frozen(st.t(p['df'], p['loc'], p['scale'])),
    'Like the normal but with heavier tails (more extreme values); approaches the normal as the degrees of freedom grow.',
    'Estimates from few data points; fuel-price shocks with fat tails.',
)
dist(
    'logistic',
    'Logistic',
    G2,
    [('loc', 'Centre', 1.0), ('scale', 'Scale', 0.05)],
    lambda p: Frozen(st.logistic(p['loc'], p['scale'])),
    'Bell-shaped, slightly heavier tails than the normal; its CDF is the S-curve of diffusion.',
    'Uncertainty in adoption and diffusion processes, technology take-up years.',
)
dist(
    'laplace',
    'Laplace (double exponential)',
    G2,
    [('loc', 'Centre', 1.0), ('scale', 'Scale', 0.07)],
    lambda p: Frozen(st.laplace(p['loc'], p['scale'])),
    'A sharp peak with exponential tails: most values very close to the centre, a few far away.',
    'Year-to-year changes of prices or demand (many small changes, a few big ones).',
)
dist(
    'cauchy',
    'Cauchy',
    G2,
    [('loc', 'Centre', 1.0), ('scale', 'Scale', 0.03)],
    lambda p: Frozen(st.cauchy(p['loc'], p['scale'])),
    'Extremely heavy tails: has no mean or variance. Always truncate it (Truncate below) in an energy model.',
    'Stress tests with very rare extreme events; robustness checks.',
)
dist(
    'gumbelmax',
    'Gumbel (largest values)',
    G2,
    [('loc', 'Location', 1.0), ('scale', 'Scale', 0.08)],
    lambda p: Frozen(st.gumbel_r(p['loc'], p['scale'])),
    'Distribution of yearly maxima; skewed towards high values.',
    'Peak demand, heat waves, flood peaks, maximum hourly load.',
)
dist(
    'gumbelmin',
    'Gumbel (smallest values)',
    G2,
    [('loc', 'Location', 1.0), ('scale', 'Scale', 0.08)],
    lambda p: Frozen(st.gumbel_l(p['loc'], p['scale'])),
    'Distribution of yearly minima; skewed towards low values.',
    'Droughts, minimum river flow (hydro), minimum wind or solar output in a season.',
)
dist(
    'skewnormal',
    'Skew normal',
    G2,
    [('a', 'Skewness shape', 4.0), ('loc', 'Location', 0.9), ('scale', 'Scale', 0.15)],
    lambda p: Frozen(st.skewnorm(p['a'], p['loc'], p['scale'])),
    'A normal curve pushed to one side (positive shape = longer upper tail).',
    'Asymmetric errors: cost overruns are more likely than underruns.',
)
dist(
    'johnsonsu',
    'Johnson SU',
    G2,
    [('gamma', 'Shape gamma', 0.0), ('delta', 'Shape delta', 2.0), ('loc', 'Location', 1.0), ('scale', 'Scale', 0.1)],
    lambda p: Frozen(st.johnsonsu(p['gamma'], p['delta'], loc=p['loc'], scale=p['scale'])),
    'Unbounded, transformed normal that can match any skew and tail weight.',
    'Fitting observed price returns or demand errors that are skewed and fat-tailed.',
)
dist(
    'gev',
    'Generalized extreme value',
    G2,
    [('xi', 'Shape xi (> 0 heavy upper tail)', 0.1), ('loc', 'Location', 1.0), ('scale', 'Scale', 0.1)],
    lambda p: Frozen(st.genextreme(-p['xi'], loc=p['loc'], scale=p['scale'])),
    'Family of block-maxima laws (Gumbel xi = 0, Frechet xi > 0, reversed Weibull xi < 0).',
    'Climate extremes: maximum temperature, rainfall, wind; reserve-margin stress.',
)
dist(
    'lognormal',
    'Lognormal',
    G3,
    [('median', 'Median', 1.0), ('sigma', 'Sigma of the log', 0.2)],
    lambda p: Frozen(st.lognorm(p['sigma'], scale=p['median'])),
    'Positive and right-skewed: the logarithm is normal. Products of many independent factors are lognormal.',
    'The standard for costs (capital, O&M), fuel prices, demand multipliers, resource sizes.',
)
dist(
    'gamma',
    'Gamma',
    G3,
    [('k', 'Shape k', 25.0), ('theta', 'Scale theta', 0.04)],
    lambda p: Frozen(st.gamma(p['k'], scale=p['theta'])),
    'Positive, right-skewed; mean = k theta. Small k = very skewed, large k = almost normal.',
    'Rainfall amounts, inflows, positive costs; waiting times.',
)
dist(
    'erlang',
    'Erlang',
    G3,
    [('k', 'Shape k (integer)', 20.0), ('theta', 'Scale theta', 0.05)],
    lambda p: Frozen(st.gamma(round(p['k']), scale=p['theta'])),
    'A gamma with integer shape: the time for k events to happen.',
    'Construction and commissioning durations made of several stages.',
)
dist(
    'exponential',
    'Exponential',
    G3,
    [('mean', 'Mean', 1.0), ('loc', 'Shift (minimum)', 0.0)],
    lambda p: Frozen(st.expon(p['loc'], p['mean'])),
    'Memoryless waiting time; the most likely value is the minimum and large values are rare.',
    'Time between outages or shocks; failure times; small-or-nothing quantities.',
)
dist(
    'weibull',
    'Weibull',
    G3,
    [('k', 'Shape k', 2.0), ('lam', 'Scale lambda', 1.0), ('loc', 'Shift', 0.0)],
    lambda p: Frozen(st.weibull_min(p['k'], loc=p['loc'], scale=p['lam'])),
    'Flexible positive law; shape 2 = Rayleigh, about 3.6 = almost normal.',
    'Wind speed (shape about 2), component lifetimes, operational life of plants.',
)
dist(
    'loglogistic',
    'Log-logistic (Fisk)',
    G3,
    [('beta', 'Shape beta', 8.0), ('alpha', 'Scale (median) alpha', 1.0)],
    lambda p: Frozen(st.fisk(p['beta'], scale=p['alpha'])),
    'Positive, with heavier upper tail than the lognormal.',
    'River flows, rainfall, income or price distributions.',
)
dist(
    'pareto',
    'Pareto',
    G3,
    [('alpha', 'Shape alpha', 3.0), ('xm', 'Minimum xm', 0.8)],
    lambda p: Frozen(st.pareto(p['alpha'], scale=p['xm'])),
    'Power-law tail above a minimum: few very large values (80/20 rule).',
    'Sizes of resources, damages of disasters, large outages.',
)
dist(
    'genpareto',
    'Generalized Pareto',
    G3,
    [('xi', 'Shape xi', 0.1), ('loc', 'Threshold', 1.0), ('scale', 'Scale', 0.1)],
    lambda p: Frozen(st.genpareto(p['xi'], loc=p['loc'], scale=p['scale'])),
    'Distribution of exceedances over a threshold (peaks over threshold).',
    'Price spikes above a level; extreme demand above normal peak.',
)
dist(
    'invgauss',
    'Inverse Gaussian (Wald)',
    G3,
    [('mean', 'Mean', 1.0), ('lam', 'Shape lambda', 25.0)],
    lambda p: Frozen(st.invgauss(p['mean'] / p['lam'], scale=p['lam'])),
    'Positive, right-skewed: first-passage time of a drifting Brownian motion.',
    'Time until a threshold is reached (cost parity, depletion); hydraulic residence times.',
)
dist(
    'invgamma',
    'Inverse gamma',
    G3,
    [('a', 'Shape a', 20.0), ('scale', 'Scale', 19.0)],
    lambda p: Frozen(st.invgamma(p['a'], scale=p['scale'])),
    'Positive with a heavy upper tail; mean = scale / (a - 1).',
    'Uncertain variances; Bayesian priors of volatilities.',
)
dist(
    'chi2',
    'Chi-square',
    G3,
    [('df', 'Degrees of freedom', 4.0), ('scale', 'Scale', 0.25)],
    lambda p: Frozen(st.chi2(p['df'], scale=p['scale'])),
    'Sum of squared normal errors; mean = df x scale.',
    'Aggregated squared errors; uncertainty of estimated variances.',
)
dist(
    'rayleigh',
    'Rayleigh',
    G3,
    [('sigma', 'Scale sigma', 0.8)],
    lambda p: Frozen(st.rayleigh(scale=p['sigma'])),
    'Magnitude of a 2-D normal vector; a Weibull with shape 2.',
    'Wind speeds; wave heights.',
)
dist(
    'frechet',
    'Frechet',
    G3,
    [('alpha', 'Shape alpha', 6.0), ('s', 'Scale', 0.9), ('loc', 'Shift', 0.0)],
    lambda p: Frozen(st.invweibull(p['alpha'], loc=p['loc'], scale=p['s'])),
    'Heavy-tailed law of maxima (bounded below).',
    'Largest floods or price peaks over long periods.',
)
dist(
    'burr',
    'Burr XII',
    G3,
    [('c', 'Shape c', 5.0), ('d', 'Shape d', 2.0), ('scale', 'Scale', 1.0)],
    lambda p: Frozen(st.burr12(p['c'], p['d'], scale=p['scale'])),
    'Flexible positive law covering lognormal-like and Pareto-like tails.',
    'Household incomes, loss and claim sizes; heavy-tailed costs.',
)
dist(
    'bernoulli',
    'Bernoulli (on / off)',
    G4,
    [('p', 'Probability of "on"', 0.2), ('off', 'Value when off', 1.0), ('on', 'Value when on', 1.5)],
    lambda p: discrete([p['off'], p['on']], [1 - p['p'], p['p']]),
    'Two outcomes: an event happens (probability p) or not. With "per year" draws it switches on and off year by year.',
    'Disruptions: pipeline or interconnector outage, drought year, policy adopted or not, plant unavailable.',
)
dist(
    'binomial',
    'Binomial',
    G4,
    [('n', 'Trials n', 10.0), ('p', 'Probability p', 0.5), ('offset', 'Value = offset +', 0.75), ('step', 'step x count', 0.05)],
    lambda p: Frozen(st.binom(int(p['n']), p['p']), True, p['offset'], p['step']),
    'Number of successes in n independent trials. The value used is offset + step x count.',
    'Number of units commissioned, projects completed, reactors available out of n.',
)
dist(
    'poisson',
    'Poisson',
    G4,
    [('lam', 'Mean count lambda', 2.0), ('offset', 'Value = offset +', 1.0), ('step', 'step x count', -0.05)],
    lambda p: Frozen(st.poisson(p['lam']), True, p['offset'], p['step']),
    'Number of rare independent events in a period. Value = offset + step x count.',
    'Number of outages, extreme events or shocks per year.',
)
dist(
    'discrete',
    'Discrete (your values)',
    G4,
    [('values', 'Values (comma)', '0.9, 1, 1.2'), ('probs', 'Probabilities (comma)', '0.25, 0.5, 0.25')],
    lambda p: discrete(numlist(p['values']), numlist(p['probs'])),
    'A short list of values with their probabilities (they are rescaled to sum to 1).',
    'Discrete scenarios: low / central / high projections, policy options, technology pathways.',
)
dist(
    'cumulative',
    'Cumulative (piecewise linear)',
    G5,
    [('values', 'Values (increasing)', '0.7, 0.9, 1, 1.2, 1.5'), ('probs', 'Cumulative probabilities', '0, 0.2, 0.5, 0.85, 1')],
    lambda p: cumulative(numlist(p['values']), numlist(p['probs'])),
    'You give points of the cumulative curve (value, probability below it); values in between are interpolated.',
    'Encoding expert elicitation (5th, 50th, 95th percentiles) or published percentiles directly.',
)
dist(
    'histogram',
    'Histogram of your data',
    G5,
    [('data', 'Data values (paste)', '0.92, 0.97, 1.0, 1.01, 1.03, 1.05, 1.08, 1.12'), ('bins', 'Bins', 6.0)],
    lambda p: Frozen(st.rv_histogram(np.histogram(numlist(p['data']), bins=max(1, int(p['bins'])))), False),
    'Uses the distribution of observed data directly (no fitting).',
    'Historical ratios: hydro inflows per year, observed capacity factors, past cost overruns.',
)
assert len(D) == 43, len(D)


def make(key, params, trunc=None):
    """the frozen distribution; trunc = (lo, hi) or None"""
    spec = D[key]
    p = {}
    for q in spec['params']:
        v = params.get(q['k'], q['default'])
        p[q['k']] = v if isinstance(q['default'], str) else float(v)
    d = spec['build'](p)
    if trunc and (trunc[0] is not None or trunc[1] is not None):
        lo = -np.inf if trunc[0] in (None, '') else float(trunc[0])
        hi = np.inf if trunc[1] in (None, '') else float(trunc[1])
        if lo >= hi:
            raise ValueError('truncation: low bound must be below high bound')
        d = Truncated(d, lo, hi)
    return d


def describe(d, n=400):
    """for the preview: x grid with density (or pmf), mean, percentiles"""
    u = np.array([0.001, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 0.999])
    q = d.ppf(u)
    out = {
        'mean': float(d.mean()),
        'pct': {str(k): float(v) for k, v in zip([0.1, 1, 5, 25, 50, 75, 95, 99, 99.9], q)},
        'discrete': bool(getattr(d, 'discrete', False)),
    }
    if out['discrete'] and hasattr(d, 'pmf'):
        v, p = d.pmf()
        keep = p > 1e-6
        out['pmf'] = {'x': v[keep].tolist(), 'p': p[keep].tolist()}
    else:
        lo, hi = q[0], q[-1]
        x = np.linspace(lo - 0.02 * (hi - lo), hi + 0.02 * (hi - lo), n)
        y = d.pdf(x)
        if y is not None:
            out['pdf'] = {'x': x.tolist(), 'y': np.nan_to_num(np.asarray(y, float)).tolist()}
    return out


# --------------------------------------------------------------------------- 11 SDEs (paths over the model years)
SDE = {}


def sde(key, name, params, explain, use, on='multiplier'):
    SDE[key] = {
        'key': key,
        'name': name,
        'params': [{'k': k, 'label': l, 'default': d} for k, l, d in params],
        'explain': explain,
        'use': use,
        'on': on,
    }


sde(
    'gbm',
    'Geometric Brownian motion',
    [('mu', 'Drift (per year)', 0.0), ('sigma', 'Volatility (per year)', 0.1)],
    'dX/X = mu dt + sigma dW. Positive, the spread grows with time (as sqrt(t)); with drift 0 the expected multiplier stays 1.',
    'Long-term uncertainty of fuel prices, demand growth, costs: "the further in time, the wider".',
)
sde(
    'abm',
    'Arithmetic Brownian motion',
    [('mu', 'Drift (per year)', 0.0), ('sigma', 'Volatility (per year)', 0.05)],
    'dX = mu dt + sigma dW. Additive shocks; can become negative (values are cut at 0 when the parameter must be positive).',
    'Additive deviations of quantities that can change sign or in absolute units (net trade, balances).',
)
sde(
    'ou',
    'Ornstein-Uhlenbeck (mean reverting)',
    [('theta', 'Speed of return (per year)', 0.3), ('sigma', 'Volatility (per year)', 0.1)],
    'dX = theta (0 - X) dt + sigma dW around the base path: deviations die out, the spread stays bounded (sigma / sqrt(2 theta)).',
    'Quantities pulled back to a trend: commodity prices around a long-run cost, demand around a projection, hydrology.',
)
sde(
    'expou',
    'Exponential OU (Schwartz one-factor)',
    [('kappa', 'Speed of return (per year)', 0.3), ('sigma', 'Volatility (per year)', 0.15)],
    'log of the multiplier is mean-reverting: positive, skewed, bounded spread. Standard model of commodity prices.',
    'Oil, gas, coal, LNG and electricity import prices.',
)
sde(
    'merton',
    'Merton jump-diffusion',
    [
        ('mu', 'Drift (per year)', 0.0),
        ('sigma', 'Volatility (per year)', 0.08),
        ('lam', 'Jumps per year', 0.2),
        ('jm', 'Mean jump (log)', -0.1),
        ('js', 'Jump spread (log)', 0.15),
    ],
    'GBM plus sudden jumps (Poisson times, lognormal sizes); the drift is compensated so that the expected multiplier stays exp(drift x t).',
    'Price shocks and crises (2008, 2022 gas crisis), sudden cost or policy changes.',
)
sde(
    'kou',
    'Kou double-exponential jumps',
    [
        ('sigma', 'Volatility (per year)', 0.08),
        ('lam', 'Jumps per year', 0.3),
        ('p', 'Probability a jump is upward', 0.4),
        ('eta1', 'Upward jump rate (1/mean size)', 10.0),
        ('eta2', 'Downward jump rate', 6.0),
    ],
    'Jumps with different sizes up and down (exponential): asymmetric shocks; compensated so the expected multiplier stays 1.',
    'Markets where spikes up and crashes down differ (gas, power prices).',
)
sde(
    'cir',
    'Cox-Ingersoll-Ross',
    [('kappa', 'Speed of return (per year)', 0.5), ('sigma', 'Volatility', 0.1)],
    'dX = kappa (1 - X) dt + sigma sqrt(X) dW: positive and mean reverting; spread shrinks near 0.',
    'Discount and interest rates, risk premiums, positive rates of change.',
)
sde(
    'jacobi',
    'Jacobi (bounded, mean reverting)',
    [
        ('kappa', 'Speed of return (per year)', 0.5),
        ('sigma', 'Volatility', 0.4),
        ('lo', 'Lower bound of the value', 0.0),
        ('hi', 'Upper bound of the value', 1.0),
    ],
    'Moves on the VALUE between two bounds, pulled back to the base value: never leaves [low, high].',
    'Capacity factors, availability, shares, efficiencies, reservoir filling (values that must stay in [0, 1]).',
    on='value',
)
sde(
    'bridge',
    'Brownian bridge',
    [('sigma', 'Volatility (per year)', 0.1)],
    'Brownian motion pinned to the base at the first and the last year: uncertain path, known end points.',
    'Targets that are fixed (policy goals, contracted volumes) with an uncertain path in between.',
)
sde(
    'regime',
    'Regime switching (two states)',
    [
        ('p12', 'Chance per year of leaving the base regime', 0.1),
        ('p21', 'Chance per year of returning', 0.3),
        ('level', 'Multiplier in the second regime', 1.3),
        ('sigma', 'Noise within a regime', 0.03),
    ],
    'A Markov chain switches between the base regime (multiplier 1) and a second regime (for example high prices), with small noise.',
    'Crisis / normal periods, wet / dry hydrological regimes, policy on / off periods.',
)
sde(
    'heston',
    'Heston (stochastic volatility)',
    [
        ('mu', 'Drift (per year)', 0.0),
        ('kappa', 'Speed of the variance', 1.5),
        ('theta', 'Long-run variance', 0.02),
        ('xi', 'Volatility of the variance', 0.3),
        ('rho', 'Correlation price / variance', -0.5),
        ('v0', 'Initial variance', 0.02),
    ],
    'Like GBM but the volatility itself moves: calm periods and turbulent periods.',
    'Prices with volatility clustering (oil, gas, carbon) over long horizons.',
)
assert len(SDE) == 11


def sde_paths(key, prm, t, Z, rng, base=None):
    """paths of the multiplier (or of the value for 'jacobi') at times t (years from the start; t[0] = 0).
    Z: standard normals, shape (n, len(t) - 1), possibly correlated with other factors. Returns (n, len(t))."""
    p = {q['k']: float(prm.get(q['k'], q['default'])) for q in SDE[key]['params']}
    n, m = Z.shape[0], len(t)
    dt = np.diff(t)
    out = np.ones((n, m))
    if key == 'gbm':
        inc = (p['mu'] - p['sigma'] ** 2 / 2) * dt + p['sigma'] * np.sqrt(dt) * Z
        out[:, 1:] = np.exp(np.cumsum(inc, 1))
    elif key == 'abm':
        out[:, 1:] = 1 + np.cumsum(p['mu'] * dt + p['sigma'] * np.sqrt(dt) * Z, 1)
    elif key in ('ou', 'expou'):
        th = p['theta'] if key == 'ou' else p['kappa']
        x = np.zeros(n)
        for j in range(m - 1):  # exact discretisation
            a = math.exp(-th * dt[j])
            s = p['sigma'] * math.sqrt((1 - a * a) / (2 * th)) if th > 0 else p['sigma'] * math.sqrt(dt[j])
            x = a * x + s * Z[:, j]
            out[:, j + 1] = 1 + x if key == 'ou' else np.exp(x)
    elif key == 'merton':
        x = np.zeros(n)
        for j in range(m - 1):
            k = rng.poisson(p['lam'] * dt[j], n)
            jump = k * p['jm'] + np.sqrt(k) * p['js'] * rng.standard_normal(n)
            comp = p['lam'] * (math.exp(p['jm'] + p['js'] ** 2 / 2) - 1)  # jump compensation: mean multiplier = exp(mu t)
            x = x + (p['mu'] - comp - p['sigma'] ** 2 / 2) * dt[j] + p['sigma'] * math.sqrt(dt[j]) * Z[:, j] + jump
            out[:, j + 1] = np.exp(x)
    elif key == 'kou':
        x = np.zeros(n)
        for j in range(m - 1):
            k = rng.poisson(p['lam'] * dt[j], n)
            jump = np.zeros(n)
            for i in np.nonzero(k)[0]:
                up = rng.random(k[i]) < p['p']
                jump[i] = rng.exponential(1 / p['eta1'], up.sum()).sum() - rng.exponential(1 / p['eta2'], (~up).sum()).sum()
            comp = (
                p['lam'] * (p['p'] * p['eta1'] / (p['eta1'] - 1) + (1 - p['p']) * p['eta2'] / (p['eta2'] + 1) - 1) if p['eta1'] > 1 else 0
            )
            x = x - (comp + p['sigma'] ** 2 / 2) * dt[j] + p['sigma'] * math.sqrt(dt[j]) * Z[:, j] + jump
            out[:, j + 1] = np.exp(x)
    elif key == 'cir':
        x = np.ones(n)
        for j in range(m - 1):
            x = np.maximum(x + p['kappa'] * (1 - x) * dt[j] + p['sigma'] * np.sqrt(np.maximum(x, 0) * dt[j]) * Z[:, j], 0)
            out[:, j + 1] = x
    elif key == 'jacobi':  # on the value, bounded, around the base path
        lo, hi = p['lo'], p['hi']
        b = np.clip(np.asarray(base if base is not None else np.ones(m), float), lo + 1e-9, hi - 1e-9)
        x = np.full(n, b[0])
        out[:, 0] = x
        for j in range(m - 1):
            x = x + p['kappa'] * (b[j + 1] - x) * dt[j] + p['sigma'] * np.sqrt(np.maximum((x - lo) * (hi - x), 0) * dt[j]) * Z[:, j]
            x = np.clip(x, lo, hi)
            out[:, j + 1] = x
    elif key == 'bridge':
        W = np.zeros((n, m))
        W[:, 1:] = np.cumsum(np.sqrt(dt) * Z, 1)
        T = t[-1] if t[-1] > 0 else 1
        B = W - (t / T)[None, :] * W[:, -1:]
        out = np.exp(p['sigma'] * B - p['sigma'] ** 2 / 2 * (t * (T - t) / T)[None, :])
    elif key == 'regime':
        s = np.zeros(n, bool)
        x = np.zeros(n)
        for j in range(m - 1):
            u = rng.random(n)
            s = np.where(s, u >= p['p21'] * dt[j], u < p['p12'] * dt[j])
            x = 0.7 * x + p['sigma'] * Z[:, j]
            out[:, j + 1] = np.where(s, p['level'], 1.0) * np.exp(x)
    elif key == 'heston':
        x = np.zeros(n)
        v = np.full(n, p['v0'])
        Z2 = rng.standard_normal(Z.shape)
        for j in range(m - 1):
            z1 = Z[:, j]
            z2 = p['rho'] * z1 + math.sqrt(max(1 - p['rho'] ** 2, 0)) * Z2[:, j]
            vp = np.maximum(v, 0)
            x = x + (p['mu'] - vp / 2) * dt[j] + np.sqrt(vp * dt[j]) * z1
            v = v + p['kappa'] * (p['theta'] - vp) * dt[j] + p['xi'] * np.sqrt(vp * dt[j]) * z2
            out[:, j + 1] = np.exp(x)
    return out


def catalogue():
    """for the Studio page"""
    return {
        'distributions': [{k: v for k, v in d.items() if k != 'build'} for d in D.values()],
        'groups': [G1, G2, G3, G4, G5],
        'sdes': list(SDE.values()),
    }
