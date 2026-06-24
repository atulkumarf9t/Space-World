"""Evaluation metrics. The headline is regret-vs-par (optimality gap)."""


def episode_metrics(result):
    return {
        "resolved": bool(result["resolved"]),
        "collision": bool(result["collision"]),
        "unsafe": result["status"] == "UNSAFE",
        "regret": result["ratio"],          # Δv_used / par_Δv  (only meaningful if resolved)
        "dvUsed": result["dvUsed"],
        "violations": result.get("violations", 0),
        "overBudget": result["dvUsed"] > 12 + 1e-6,
    }


def aggregate(results):
    n = len(results) or 1
    resolved = [r for r in results if r["resolved"]]
    regrets = [r["ratio"] for r in resolved if r["ratio"] is not None]
    return {
        "n": len(results),
        "success_pct": round(100 * len(resolved) / n, 1),
        "mean_regret": round(sum(regrets) / len(regrets), 3) if regrets else None,
        "collisions": sum(1 for r in results if r["collision"]),
        "unsafe": sum(1 for r in results if r["status"] == "UNSAFE"),
        "mean_dv": round(sum(r["dvUsed"] for r in results) / n, 3),
        "violations": sum(r.get("violations", 0) for r in results),
        "over_budget": sum(1 for r in results if r["dvUsed"] > 12 + 1e-6),
    }
