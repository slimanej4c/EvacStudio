"""Structured NF X 08-070 export rules shared by API validation and audits."""

DOCUMENT_TYPE_CHOICES = (
    ('evacuation', "Plan d’évacuation"),
    ('intervention', "Plan d’intervention"),
    ('room', "Plan de chambre ou pièce individuelle"),
    ('instructions', "Consignes seules"),
    ('technical_safety', "Plan technique de sécurité"),
)
PAPER_FORMAT_CHOICES = (
    ('a4', 'A4'),
    ('a3', 'A3'),
    ('a2', 'A2'),
)

PAPER_RANK = {'a4': 0, 'a3': 1, 'a2': 2}
MINIMUM_PAPER_BY_DOCUMENT_TYPE = {
    'evacuation': 'a3',
    'intervention': 'a3',
    'room': 'a4',
}
RECOMMENDED_SCALE_DENOMINATOR = 250
STANDARD_MAX_SCALE_DENOMINATOR = 250
A2_MAX_SCALE_DENOMINATOR = 350
PAPER_DIMENSION_TOLERANCE_PERCENT = 5


def automatic_plan_number(plan_id):
    return f"PLAN-{plan_id:06d}"


def maximum_scale_denominator(paper_format):
    return (
        A2_MAX_SCALE_DENOMINATOR
        if paper_format == 'a2'
        else STANDARD_MAX_SCALE_DENOMINATOR
    )


def export_compliance_errors(
    document_type,
    paper_format,
    scale_denominator,
    measured_scale_denominator=None,
):
    """Return field-keyed blocking errors; recommendations remain UI warnings."""
    errors = {}
    minimum_paper = MINIMUM_PAPER_BY_DOCUMENT_TYPE.get(document_type)
    if (
        minimum_paper
        and paper_format in PAPER_RANK
        and PAPER_RANK[paper_format] < PAPER_RANK[minimum_paper]
    ):
        errors['export_paper_format'] = (
            f"Le type de document « {document_type} » exige au minimum le format "
            f"{minimum_paper.upper()}."
        )

    if scale_denominator is not None:
        maximum = maximum_scale_denominator(paper_format)
        if scale_denominator > maximum:
            errors['print_scale_denominator'] = (
                f"L’échelle 1:{scale_denominator} dépasse la limite 1:{maximum}. "
                f"La tolérance de {PAPER_DIMENSION_TOLERANCE_PERCENT} % concerne "
                "les dimensions du format papier, pas l’échelle."
            )

    if measured_scale_denominator is not None:
        maximum = maximum_scale_denominator(paper_format)
        if measured_scale_denominator > maximum:
            errors['measured_scale_denominator'] = (
                f"L’échelle mesurée 1:{measured_scale_denominator:.1f} dépasse "
                f"la limite 1:{maximum}."
            )
    return errors
