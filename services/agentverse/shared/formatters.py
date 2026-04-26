"""Format structured artifact dicts into readable Markdown for ASI:One chat."""
from __future__ import annotations


def format_fix_code(data: dict) -> str:
    lang = data.get("language") or ""
    diagnosis = data.get("diagnosis") or "Unknown issue"
    original = data.get("original") or ""
    fixed = data.get("fixed") or ""
    changes = data.get("changes") or []

    fence = f"```{lang}" if lang else "```"
    lines = [
        f"🔧 **Bug Found**{f' ({lang})' if lang else ''}",
        f"_{diagnosis}_",
        "",
    ]
    if original:
        lines += [f"**Before:**", fence, original, "```", ""]
    if fixed:
        lines += [f"**Fixed:**", fence, fixed, "```", ""]
    if changes:
        lines.append("**Changes:**")
        for c in changes:
            lines.append(f"• {c}")
    return "\n".join(lines)


def format_food_order(data: dict) -> str:
    dish = data.get("dish") or ""
    cuisine = data.get("cuisine") or ""
    recipe = data.get("recipe") or {}
    order_options = data.get("order_options") or []
    nearby_query = data.get("nearby_query") or ""

    ingredients = recipe.get("ingredients") or []
    steps = recipe.get("steps") or []
    time_min = recipe.get("time_min")

    header = f"🍜 **{dish}**"
    if cuisine:
        header += f" _{cuisine}_"
    lines = [header]

    if time_min:
        lines.append(f"⏱ {time_min} min")

    if ingredients:
        lines += ["", "**Ingredients:**"]
        for ing in ingredients:
            lines.append(f"• {ing}")

    if steps:
        lines += ["", "**Steps:**"]
        for i, step in enumerate(steps, 1):
            lines.append(f"{i}. {step}")

    if order_options:
        lines += ["", "**Order now:**"]
        for opt in order_options:
            platform = opt.get("platform") or ""
            url = opt.get("url") or ""
            if url:
                lines.append(f"• [{platform}]({url})")
            elif opt.get("search_query"):
                lines.append(f"• {platform}: _{opt['search_query']}_")

    if nearby_query:
        q = nearby_query.replace(" ", "+")
        lines += [
            "",
            f"📍 [Find nearby on Google Maps](https://www.google.com/maps/search/{q})",
        ]

    return "\n".join(lines)


def format_restaurant_booking(data: dict) -> str:
    name = data.get("name") or ""
    cuisine = data.get("cuisine") or ""
    rating = data.get("rating")
    price_level = data.get("price_level") or ""
    description = data.get("description") or ""
    address = data.get("address") or ""
    phone = data.get("phone")
    hours = data.get("hours")
    opentable_url = data.get("opentable_url") or ""
    opentable_query = data.get("opentable_query") or name

    header = f"🍽️ **{name}**"
    if cuisine:
        header += f" _{cuisine}_"
    if rating:
        header += f" ★{rating}"
    if price_level:
        header += f" | {price_level}"

    lines = [header, ""]

    if description:
        lines += [description, ""]

    if address:
        lines.append(f"📍 {address}")
    if phone:
        lines.append(f"📞 {phone}")
    if hours:
        lines.append(f"⏰ {hours}")

    lines.append("")

    if opentable_url:
        lines.append(f"👉 **[Book on OpenTable]({opentable_url})**")
    else:
        q = opentable_query.replace(" ", "+")
        lines.append(f"👉 **[Search OpenTable](https://www.opentable.com/s/?term={q})**")

    return "\n".join(lines)


def format_answer(data: dict) -> str:
    title = data.get("title") or ""
    body = data.get("body") or ""
    followups = data.get("followups") or []

    lines = []
    if title:
        lines += [f"**{title}**", ""]
    if body:
        lines.append(body)
    if followups:
        lines += ["", "_You might also ask:_"]
        for f in followups:
            lines.append(f"• {f}")
    return "\n".join(lines) if lines else str(data)
