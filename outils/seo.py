# Injecte les balises Open Graph + données structurées JSON-LD (schema.org)
# dans chaque page publique. Idempotent : le bloc SEO est remplacé à chaque run.
import re, json, html
SITE='https://sobiose.fr/'
def url(p): return SITE if p=='index.html' else SITE+p
PAGES=['index.html','offres.html','entreprises.html','sophrologie-musique.html','a-propos.html','contact.html','reservation.html']
AREA=[{"@type":"City","name":n} for n in ["Marmande","Tonneins","Agen","Bordeaux"]]+[{"@type":"AdministrativeArea","name":"Lot-et-Garonne"},{"@type":"AdministrativeArea","name":"Gironde"},{"@type":"Country","name":"France"}]
PERSON={"@type":"Person","@id":SITE+"#marie-laurence-bonneau","name":"Marie-Laurence Bonneau","url":SITE+"a-propos.html","worksFor":{"@id":SITE+"#cabinet"},"image":SITE+"images/marie-laurence.jpg",
  "jobTitle":"Sophrologue certifiée RNCP niveau 5",
  "hasOccupation":[{"@type":"Occupation","name":"Sophrologue"},{"@type":"Occupation","name":"Aide-soignante"}],
  "alumniOf":{"@type":"EducationalOrganization","name":"ISSO Toulouse"},
  "hasCredential":{"@type":"EducationalOccupationalCredential","name":"Certification de sophrologue inscrite au RNCP (niveau 5)","credentialCategory":"Certification professionnelle"},
  "knowsAbout":["Sophrologie","Relaxation","Gestion du stress","Qualité de vie et des conditions de travail","Prévention des risques psychosociaux","Sommeil","Création sonore"],
  "sameAs":["https://www.youtube.com/@marie-c9j7u"]}
BUSINESS={"@type":"ProfessionalService","@id":SITE+"#cabinet","name":"SoBiOse","alternateName":"SoBiOse — Marie-Laurence Bonneau, sophrologie & relaxation","url":SITE,
  "sameAs":["https://www.youtube.com/@marie-c9j7u"],
  "description":"Sophrologie et relaxation en visio pour adultes et adolescents dès 15 ans, ateliers de groupe dans le Marmandais, interventions en entreprise et séances de sophrologie musicale.",
  "address":{"@type":"PostalAddress","addressLocality":"Grézet-Cavagnan","postalCode":"47250","addressRegion":"Nouvelle-Aquitaine","addressCountry":"FR"},
  "areaServed":AREA,"founder":{"@id":SITE+"#marie-laurence-bonneau"},"priceRange":"€€",
  "knowsLanguage":"fr"}
def service(name,desc,stype,audience):
    return {"@type":"Service","name":name,"description":desc,"serviceType":stype,"provider":{"@id":SITE+"#cabinet"},"areaServed":AREA,"audience":{"@type":"Audience","audienceType":audience}}
EXTRA={
 'index.html':[BUSINESS,PERSON],
 'a-propos.html':[PERSON,BUSINESS],
 'entreprises.html':[BUSINESS,service("Sophrologie en entreprise","Ateliers QVCT de 1h à 2h, parcours de 4 à 8 séances et accompagnement individuel des managers et dirigeants, sur site ou en visio.","Sophrologie et relaxation en entreprise","Entreprises, établissements de santé, managers et salariés")],
 'sophrologie-musique.html':[BUSINESS,service("Sophrologie et musique","Séances de sophrologie et relaxation sur compositions originales ou co-animées avec des musiciens, pour groupes, collectivités, associations et événements culturels.","Sophrologie musicale","Mairies, associations, lieux culturels, groupes")],
 'offres.html':[BUSINESS,service("Séances de sophrologie en visio","Séances individuelles de sophrologie et relaxation en visio pour adultes et adolescents dès 15 ans : stress, sommeil, confiance en soi, examens.","Sophrologie individuelle","Adultes et adolescents dès 15 ans")],
 'contact.html':[BUSINESS],
 'reservation.html':[],
}
SITEMAP_PRIORITY={'index.html':'1.0','offres.html':'0.9','entreprises.html':'0.9','sophrologie-musique.html':'0.8','a-propos.html':'0.7','contact.html':'0.7','reservation.html':'0.6'}
def faq(s):
    items=re.findall(r'<details class="faq-item">\s*<summary>(.*?)</summary>\s*<p>(.*?)</p>',s,flags=re.S)
    clean=lambda t: html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>','',t))).strip()
    return {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":clean(q),"acceptedAnswer":{"@type":"Answer","text":clean(a)}} for q,a in items]} if items else None
for p in PAGES:
    s=open(p).read()
    s=re.sub(r'\n<!-- SEO:START -->.*?<!-- SEO:END -->','',s,flags=re.S)
    title=html.unescape(re.search(r'<title>(.*?)</title>',s).group(1))
    desc=re.search(r'<meta name="description" content="(.*?)">',s).group(1)
    graph=list(EXTRA[p]); f=faq(s)
    if f: graph.append(f)
    block='\n<!-- SEO:START -->\n'
    block+=f'<link rel="canonical" href="{url(p)}">\n<meta property="og:url" content="{url(p)}">\n<meta property="og:site_name" content="SoBiOse">\n<meta property="og:image" content="{SITE}images/marie-laurence.jpg">\n'
    block+=f'<meta property="og:type" content="website">\n<meta property="og:locale" content="fr_FR">\n<meta property="og:title" content="{html.escape(title)}">\n<meta property="og:description" content="{desc}">\n'
    if graph:
        block+='<script type="application/ld+json">\n'+json.dumps({"@context":"https://schema.org","@graph":graph},ensure_ascii=False,indent=1)+'\n</script>\n'
    block+='<!-- SEO:END -->'
    s=s.replace('<link rel="preconnect" href="https://fonts.googleapis.com">',block.lstrip('\n')+'\n\n<link rel="preconnect" href="https://fonts.googleapis.com">',1)
    open(p,'w').write(s); print(p,len(graph),'faq' if f else '')

# sitemap.xml + robots.txt
with open('sitemap.xml','w') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    for p in PAGES:
        f.write(f'  <url><loc>{url(p)}</loc><priority>{SITEMAP_PRIORITY[p]}</priority></url>\n')
    f.write('</urlset>\n')
with open('robots.txt','w') as f:
    # Les pages privées (admin, paiement…) portent une balise noindex : on les
    # laisse explorables pour que Google puisse lire cette balise.
    f.write('User-agent: *\nAllow: /\n\nSitemap: '+SITE+'sitemap.xml\n')
