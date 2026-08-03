import cv2
import numpy as np


def _load_image(image):
    if isinstance(image, np.ndarray):
        return image

    if isinstance(image, bytes):
        image_array = np.frombuffer(image, dtype=np.uint8)
        decoded = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if decoded is None:
            raise ValueError("Image bytes invalides.")
        return decoded

    if isinstance(image, str):
        loaded = cv2.imread(image)
        if loaded is None:
            raise ValueError(f"Impossible de lire l'image: {image}")
        return loaded

    image.seek(0)
    image_bytes = image.read()
    image.seek(0)
    return _load_image(image_bytes)


def _prepare_binary_walls(image):
    loaded = _load_image(image)
    gray = cv2.cvtColor(loaded, cv2.COLOR_BGR2GRAY) if len(loaded.shape) == 3 else loaded
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        35,
        9,
    )
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    return binary


def _resize_like(image, reference):
    if image.shape == reference.shape:
        return image
    return cv2.resize(image, (reference.shape[1], reference.shape[0]), interpolation=cv2.INTER_NEAREST)


def _component_summaries(mask, min_area):
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    summaries = []
    for label in range(1, count):
        x, y, width, height, area = stats[label]
        if area < min_area:
            continue
        summaries.append({
            "position": {
                "x": int(x),
                "y": int(y),
                "largeur": int(width),
                "hauteur": int(height),
            },
            "surface": int(area),
        })
    return summaries


def _opening_candidates(mask):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    image_area = mask.shape[0] * mask.shape[1]
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        area = width * height
        if area < max(30, image_area * 0.00002):
            continue
        aspect_ratio = max(width, height) / max(1, min(width, height))
        if 1.8 <= aspect_ratio <= 12:
            candidates.append((x + width / 2, y + height / 2))
    return candidates


def _count_moved_openings(original_mask, generated_mask):
    original_edges = cv2.Canny(original_mask, 50, 150)
    generated_edges = cv2.Canny(generated_mask, 50, 150)
    original_candidates = _opening_candidates(original_edges)
    generated_candidates = _opening_candidates(generated_edges)

    if not original_candidates or not generated_candidates:
        return 0

    moved = 0
    tolerance = max(original_mask.shape[:2]) * 0.04
    for original_x, original_y in original_candidates:
        nearest = min(
            ((original_x - generated_x) ** 2 + (original_y - generated_y) ** 2) ** 0.5
            for generated_x, generated_y in generated_candidates
        )
        if nearest > tolerance:
            moved += 1
    return moved


def verifier_plans(plan_original, plan_genere):
    original_mask = _prepare_binary_walls(plan_original)
    generated_mask = _resize_like(_prepare_binary_walls(plan_genere), original_mask)

    missing_mask = cv2.bitwise_and(original_mask, cv2.bitwise_not(generated_mask))
    invented_mask = cv2.bitwise_and(generated_mask, cv2.bitwise_not(original_mask))

    min_area = max(40, int(original_mask.shape[0] * original_mask.shape[1] * 0.00004))
    murs_oublies = _component_summaries(missing_mask, min_area)
    murs_inventes = _component_summaries(invented_mask, min_area)
    ouvertures_deplacees_count = _count_moved_openings(original_mask, generated_mask)

    original_pixels = max(1, int(np.count_nonzero(original_mask)))
    generated_pixels = max(1, int(np.count_nonzero(generated_mask)))
    missing_ratio = min(1.0, float(np.count_nonzero(missing_mask)) / original_pixels)
    invented_ratio = min(1.0, float(np.count_nonzero(invented_mask)) / generated_pixels)
    moved_penalty = min(0.3, ouvertures_deplacees_count * 0.05)
    score = max(0.0, 1.0 - (missing_ratio * 0.45) - (invented_ratio * 0.35) - moved_penalty)

    recommandations = []
    if murs_oublies:
        recommandations.append("Restaurer les segments de murs absents du plan genere.")
    if murs_inventes:
        recommandations.append("Supprimer les segments ajoutes qui ne sont pas visibles sur le plan original.")
    if ouvertures_deplacees_count:
        recommandations.append("Repositionner les ouvertures detectees comme deplacees.")
    if not recommandations:
        recommandations.append("Aucune correction majeure detectee.")

    return {
        "murs_oublies": murs_oublies,
        "murs_inventes": murs_inventes,
        "ouvertures_deplacees": ouvertures_deplacees_count,
        "score": round(score, 3),
        "recommandations": recommandations,
    }
