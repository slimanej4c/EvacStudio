from django.db import migrations, models


def populate_automatic_references(apps, schema_editor):
    EvacuationPlan = apps.get_model("evacuation_plans", "EvacuationPlan")
    for plan in EvacuationPlan.objects.all().only("id", "plan_number", "revision_index"):
        updates = []
        if not plan.plan_number:
            plan.plan_number = f"PLAN-{plan.pk:06d}"
            updates.append("plan_number")
        if not plan.revision_index:
            plan.revision_index = "A"
            updates.append("revision_index")
        if updates:
            plan.save(update_fields=updates)


class Migration(migrations.Migration):

    dependencies = [
        ("evacuation_plans", "0033_evacuationplan_plan_information_layout"),
    ]

    operations = [
        migrations.AlterField(
            model_name="evacuationplan",
            name="revision_index",
            field=models.CharField(blank=True, default="A", max_length=50),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="document_type",
            field=models.CharField(
                blank=True,
                choices=[
                    ("evacuation", "Plan d’évacuation"),
                    ("intervention", "Plan d’intervention"),
                    ("room", "Plan de chambre ou pièce individuelle"),
                    ("instructions", "Consignes seules"),
                    ("technical_safety", "Plan technique de sécurité"),
                ],
                default="",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="export_paper_format",
            field=models.CharField(
                choices=[("a4", "A4"), ("a3", "A3"), ("a2", "A2")],
                default="a3",
                max_length=2,
            ),
        ),
        migrations.AddField(
            model_name="evacuationplan",
            name="print_scale_denominator",
            field=models.PositiveIntegerField(default=250),
        ),
        migrations.RunPython(populate_automatic_references, migrations.RunPython.noop),
    ]
