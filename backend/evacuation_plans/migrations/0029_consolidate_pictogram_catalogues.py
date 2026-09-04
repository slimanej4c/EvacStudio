from django.db import migrations


PICTOGRAM_TYPE_MIGRATIONS = {
    # Ancien catalogue NF X 08-070 -> catalogue structuré actuel.
    "Accès pompiers principal": "nfx08070:07-acces:acces-second",
    "Accès pompiers": "nfx08070:07-acces:acces-partiel",
    "Arrêt d'urgence": "nfx08070:12-elec:coupure-urgence",
    "Ascenseur": "nfx08070:05-elev:asc",
    "Bac à sable": "nfx08070:08-divers:div_seau",
    "Barrage eau incendie": "nfx08070:03-lutte:eau-incendie",
    "Bouche d’incendie": "nfx08070:06-eau:bouche",
    "Bouteilles de gaz": "nfx08070:13-fluides:bouteilles",
    "Centralisateur de mise en sécurité incendie": "nfx08070:02-alerte:cmsi",
    "chaufferier": "nfx08070:13-fluides:chau",
    "Cheminement d'évacuation": "nfx08070:01-evacuation:chemin",
    "Colonne humide": "nfx08070:03-lutte:3b-colonnes:ch-ref",
    "Colonne sèche": "nfx08070:03-lutte:3b-colonnes:cs-ref",
    "Commande de désenfumage": "nfx08070:03-lutte:desemf",
    "Commande manuelle d’un extincteur automatique total à un local": "nfx08070:03-lutte:auto-locale-cde",
    "Coupure gaz": "nfx08070:13-fluides:coupure-gaz",
    "Coupure électricité basse tension": "nfx08070:12-elec:coupure-bt",
    "Coupure électricité haute tension": "nfx08070:12-elec:coupure-ht",
    "Déclencheur manuel d’alarme incendie": "nfx08070:02-alerte:dm",
    "Equipement divers de lutte contre l’incendie (à préciser)": "nfx08070:03-lutte:divers",
    "Espace d’attente sécurisé": "nfx08070:01-evacuation:eas",
    "Extincteur  sur roues": "nfx08070:03-lutte:3a-extincteurs:lutte_ext_roue",
    "Extincteur": "nfx08070:03-lutte:3a-extincteurs:lutte_ext",
    "Gaz sous pression": "nfx08070:11-produits:clp-gaz",
    "Grouoe ventilisation": "nfx08070:10-technique:grp-ventil",
    "Groupe climatisation": "nfx08070:10-technique:grp-clim",
    "Issue finale": "nfx08070:01-evacuation:is_d",
    "Itinéraire d’évacuation": "nfx08070:01-evacuation:chemin",
    "Local électrique": "nfx08070:12-elec:elec",
    "Monte-charge": "nfx08070:05-elev:m-charge",
    "Pharmacie": "nfx08070:04-secours:pharma",
    "Point de rassemblement": "nfx08070:01-evacuation:rassemblement",
    "Porte coupe-feu": "nfx08070:03-lutte:pcf",
    "Poteau d'incendie": "nfx08070:06-eau:poteau",
    "Produits dangereux pour la santé et l’environnement": "nfx08070:11-produits:clp-nocif",
    "Raccord ZAG": "nfx08070:03-lutte:zag",
    "Robinet d'incendie armé": "nfx08070:03-lutte:ria",
    "Système sécurité incendie": "nfx08070:02-alerte:ssi",
    "Téléphone de sécurité incendie": "nfx08070:02-alerte:tel-urgence",
    "Transformateur": "nfx08070:12-elec:transfo",
    "accés à une toiture": "nfx08070:07-acces:toiture",
    "vous etes ici": "nfx08070:vous-ici",

    # Pictogrammes réellement complémentaires -> catalogue Autres.
    "Baie accessible": "other:04-technique:baie accessible",
    "Coupure air comprimé": "other:04-technique:coupure air comprimé",
    "Coupure fluides FM médicaux": "other:04-technique:coupure fluides fm médicaux",
    "Coupure hydrogène": "other:04-technique:coupure hydrogène",
    "Coupure oxygène": "other:04-technique:coupure oxygène",
    "Dépôt fioul": "other:04-technique:dépôt fioul",
    "Dépôt liquide inflammable": "other:04-technique:dépôt liquide inflammable",
    "Elévateur pour personnes à mobilité réduite (PMR)": "other:04-technique:elévateur pour personnes à mobilité réduite (pmr)",
    "Escalier descendant": "other:02-evacuation:escalier descendant",
    "10": "other:05-incendie:10",
    "11": "other:05-incendie:11",
    "15-118": "other:03-secours:15-18",
    "15-18": "other:03-secours:15-18",
    "air": "other:04-technique:air",
    "cheminement evacuation": "other:02-evacuation:cheminement evacuation",
    "direction": "other:02-evacuation:direction",
    "ear-svgrepo-com": "other:01-accessibilite:ear-svgrepo-com",
    "escalier 1": "other:02-evacuation:escalier 1",
    "escalier 2": "other:02-evacuation:escalier 2",
    "escalier circle": "other:02-evacuation:escalier circle",
    "escalier droit": "other:02-evacuation:escalier droit",
    "escalier_autocad": "other:02-evacuation:escalier_autocad",
    "evacuation-2": "other:02-evacuation:evacuation-2",
    "evacuation-3": "other:02-evacuation:evacuation-3",
    "evacuation1": "other:02-evacuation:evacuation1",
    "fire": "other:05-incendie:fire",
    "icon_11_clean_safe": "other:01-accessibilite:icon_11_clean_safe",
    "icon_12_clean_safe": "other:04-technique:icon_12_clean_safe",
    "icon_13_clean_safe": "other:05-incendie:icon_13_clean_safe",
    "icon_15_clean_safe": "other:01-accessibilite:icon_15_clean_safe",
    "mege-phone": "other:03-secours:mege-phone",
    "svg-selection(4)": "other:03-secours:svg-selection(4)",
    "telephone_rouge_final_corrige": "other:03-secours:telephone_rouge_final_corrige",
    "telephone_vert": "other:03-secours:telephone_vert",
    "urgence-01": "other:03-secours:urgence-01",
    "urgence-02": "other:01-accessibilite:urgence-02",
    "urgence-03": "other:02-evacuation:urgence-03",
    "urgence-05": "other:02-evacuation:urgence-05",
    "urgence-sourds": "other:01-accessibilite:urgence-sourds",

    # Doublons de l'ancien dossier général.
    "Issue finale - panneau complet": "nfx08070:01-evacuation:is_d",
    "accident": "nfx08070:04-secours:pharma",
    "exticnteur": "nfx08070:03-lutte:3a-extincteurs:lutte_ext",
    "icon_10_clean_safe": "nfx08070:02-alerte:dm",
    "icon_14_clean_safe": "nfx08070:01-evacuation:rassemblement",
    "itineraire_evacuation": "nfx08070:01-evacuation:chemin",
}


LEGACY_SAFETY_REDS = (
    "#B71C2D",
    "#EC1C24",
    "#ED1C24",
    "#EF233C",
    "#E63329",
    "#EF4444",
)


def consolidate_pictograms(apps, schema_editor):
    PlanIcon = apps.get_model("evacuation_plans", "PlanIcon")
    for previous_type, current_type in PICTOGRAM_TYPE_MIGRATIONS.items():
        PlanIcon.objects.filter(icon_type=previous_type).update(icon_type=current_type)
    for previous_red in LEGACY_SAFETY_REDS:
        PlanIcon.objects.filter(color__iexact=previous_red).update(color="#C1121C")


class Migration(migrations.Migration):

    dependencies = [
        ("evacuation_plans", "0028_sheettemplateasset"),
    ]

    operations = [
        migrations.RunPython(consolidate_pictograms, migrations.RunPython.noop),
    ]
