from pathlib import Path
import shutil, json, zipfile
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'output/pdf'; OUT.mkdir(exist_ok=True,parents=True)
for n,f in [('Body','arial.ttf'),('Bold','arialbd.ttf'),('Mono','consola.ttf')]:pdfmetrics.registerFont(TTFont(n,'C:/Windows/Fonts/'+f))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Body',boldItalic='Bold')
W,H=A4; BLUE='#164BCE'; ORANGE='#E43E16'
profiles={
'Tech-Lead':{
 'title':'TECH LEAD / FRONT-END LEAD',
 'EN':'Senior software and design professional with 14 years of experience. Three years as Jobrapido’s Front-end Lead and sole front-end engineer, owning design, architecture and development. Combines hands-on delivery with architectural decisions and technical coordination across company leadership and backend partners.',
 'IT':'Professionista senior con 14 anni di esperienza nello sviluppo software e nel design. Per tre anni Front-end Lead e unico sviluppatore front-end di Jobrapido, con responsabilità su design, architettura e sviluppo. Unisce lavoro operativo, decisioni architetturali e coordinamento tecnico tra direzione aziendale e partner backend.',
 'focusEN':'Front-end architecture, technical ownership and delivery',
 'focusIT':'Architettura front-end, responsabilità tecnica e sviluppo',
 'meiEN':'Own interaction design, application development and AI integration for a codec-inspired assistant. Connect the product concept to an implemented interface and workflow.',
 'meiIT':'Curo design delle interazioni, sviluppo applicativo e integrazione AI di un assistente ispirato al Codec, collegando il concept a interfacce e flussi di lavoro implementati.',
 'grayEN':'Lead product direction, interface design and software development for a video-editing environment with AI assistance. Connect editing workflows, component structure and implementation.',
 'grayIT':'Curo direzione di prodotto, design e sviluppo di un ambiente di montaggio video con assistenza AI, collegando flussi di editing, struttura a componenti e implementazione.',
},
'AI-Engineer':{
 'title':'AI ENGINEER / SOFTWARE ENGINEER',
 'EN':'Software and design professional with 14 years of experience, now focused on integrating AI into usable applications. Owns product direction, software development and AI integration in Mei Ling and Grayfox. Brings three years of front-end leadership at Jobrapido and experience turning technical choices into working product experiences.',
 'IT':'Professionista con 14 anni di esperienza nello sviluppo software e nel design, oggi focalizzato sull’integrazione dell’AI in applicazioni utilizzabili. Curo direzione di prodotto, sviluppo e integrazione AI in Mei Ling e Grayfox. Porto tre anni di leadership front-end in Jobrapido e l’esperienza per tradurre scelte tecniche in prodotti funzionanti.',
 'focusEN':'AI integration, application engineering and usable workflows',
 'focusIT':'Integrazione AI, sviluppo applicativo e flussi di lavoro',
 'meiEN':'Build an AI assistant around creative workflows, combining application development, AI integration and interaction design. The public demo makes the assistant accessible through a dedicated codec-inspired interface.',
 'meiIT':'Sviluppo un assistente AI per flussi di lavoro creativi, unendo sviluppo applicativo, integrazione AI e design delle interazioni. La demo pubblica rende l’assistente accessibile tramite un’interfaccia ispirata al Codec.',
 'grayEN':'Develop a video-editing environment connecting AI assistance with concrete editing tasks. Own the product, design and implementation; the web demo presents a bounded subset of the wider project.',
 'grayIT':'Sviluppo un ambiente di montaggio video che collega assistenza AI e attività concrete di editing. Curo prodotto, design e implementazione; la demo web presenta un sottoinsieme delle funzionalità del progetto.',
},
'Product-Designer':{
 'title':'PRODUCT DESIGNER / DESIGN LEAD',
 'EN':'Senior multidisciplinary designer with 14 years of experience connecting visual design, interaction and software development. Owns product concepts, design systems and implemented interfaces. At Jobrapido, combined front-end design responsibility with architecture and development; at HiBye, connected design direction, technical delivery and business stakeholders.',
 'IT':'Designer senior multidisciplinare con 14 anni di esperienza tra design visivo, interazione e sviluppo software. Curo concept di prodotto, design system e interfacce implementate. In Jobrapido ho unito la responsabilità sul design front-end ad architettura e sviluppo; in HiBye ho collegato direzione del design, sviluppo e interlocutori aziendali.',
 'focusEN':'Product concepts, interaction design and design systems',
 'focusIT':'Concept di prodotto, interazioni e design system',
 'meiEN':'Define the interaction model and visual direction of a codec-inspired AI assistant. Connect a distinctive interface with creative workflows, taking the concept through prototyping and implementation.',
 'meiIT':'Definisco il modello di interazione e la direzione visiva di un assistente AI ispirato al Codec. Collego un’interfaccia riconoscibile ai flussi creativi, dal concept alla prototipazione e all’implementazione.',
 'grayEN':'Shape the product direction and interface of a video-editing environment with AI assistance. Translate editing needs into workflows and reusable interface structures, supported by hands-on software development.',
 'grayIT':'Curo direzione di prodotto e interfaccia di un ambiente di montaggio con assistenza AI. Traduco le esigenze di editing in flussi e strutture di interfaccia riutilizzabili, affiancando il design allo sviluppo software.',
}}

def build(key,lang):
 global y,c
 p=profiles[key]; it=lang=='IT'; choose=lambda en,italian:italian if it else en
 dest=OUT/f'Francesco-Saccullo_CV_{key}_{lang}.pdf'
 c=canvas.Canvas(str(dest),pagesize=A4,pageCompression=1);c.setTitle('Francesco Saccullo | '+p['title']);c.setAuthor('Francesco Saccullo')
 def txt(s,size=10.2,font='Body',color='#121212',after=6):
  global y
  para=Paragraph(s,ParagraphStyle('body',fontName=font,fontSize=size,leading=size*1.36,textColor=HexColor(color)))
  _,h=para.wrap(W-88,H)
  if y-h<48:raise ValueError(f'Overflow {key} {lang}: {s[:45]} at {y}')
  para.drawOn(c,44,y-h);y-=h+after
 def page(n):
  global y
  c.setFillColor(HexColor('#F4EFE6'));c.rect(0,0,W,H,fill=1,stroke=0);c.setFillColor(HexColor(ORANGE));c.rect(44,H-34,40,4,fill=1,stroke=0)
  c.setFillColor(HexColor('#55514C'));c.setFont('Mono',7.4);c.drawString(44,27,'FRANCESCO SACCULLO / '+key.replace('-',' ').upper());c.drawRightString(W-44,27,f'{lang} / {n} / 2');y=H-53
 def section(s):
  global y
  y-=5;c.setStrokeColor(HexColor('#121212'));c.setLineWidth(.6);c.line(44,y,W-44,y);y-=13;txt(s,10,'Mono',ORANGE,8)
 def role(company,title,dates,items):
  global y
  txt(company+' / '+dates,11,'Bold',after=2);txt(title,10,'Bold',BLUE,5)
  for b in items:txt('• '+b,10,after=4)
  y-=5
 page(1)
 txt('FRANCESCO SACCULLO',28,'Bold',after=8);txt(p['title'],12,'Bold',BLUE,6);txt(p['focus'+lang],9.4,after=10)
 txt(choose('Piacenza, Italy · Open to remote and hybrid opportunities','Piacenza, Italia · Disponibile per opportunità da remoto e ibride'),8.7,after=3)
 txt('<link href="mailto:saccullo.francesco@gmail.com">saccullo.francesco@gmail.com</link> · <link href="tel:+393701130993">+39 370 113 0993</link>',8.7,after=3)
 txt('<link color="'+BLUE+'" href="https://www.linkedin.com/in/francescosaccullo/">LinkedIn</link> / <link color="'+BLUE+'" href="https://github.com/MiuraChan">GitHub</link> / <link color="'+BLUE+'" href="https://francesco-saccullo-mediakit.web.app/">Mediakit</link>',8.7,after=6)
 section(choose('PROFILE','PROFILO'));txt(p[lang],10.3,after=6)
 section(choose('PROFESSIONAL EXPERIENCE','ESPERIENZA PROFESSIONALE'))
 txt(choose('INDEPENDENT PROJECTS / 2026 - Present','PROGETTI INDIPENDENTI / 2026 - Presente'),11,'Bold',after=3)
 txt('Software Engineer, Designer &amp; AI Manager',10,'Bold',BLUE,8)
 for name,slug,body in [('MEI LING','meiling',p['mei'+lang]),('GRAYFOX','grayfox',p['gray'+lang])]:
  txt('<b>'+name+'</b> / <link href="https://francesco-saccullo-mediakit.web.app/'+slug+'/" color="'+BLUE+'"><b>'+choose('OPEN LIVE DEMO','APRI LA DEMO')+'</b></link>',11,after=4)
  txt(body,10,after=3)
  txt('<link href="https://francesco-saccullo-mediakit.web.app/'+slug+'/" color="'+BLUE+'">francesco-saccullo-mediakit.web.app/'+slug+'/</link>',8.5,after=10)
 role('JOBRAPIDO',choose('Software Engineer | Front-end Lead for three years','Software Engineer | Front-end Lead per tre anni'),'2022 - 2026',[
 choose('Sole front-end engineer during the three-year lead period, responsible for front-end design, architecture and development.','Unico sviluppatore front-end nei tre anni da lead, responsabile di design, architettura e sviluppo front-end.'),
 choose('Led technical and design decisions while building responsive search applications with modern JavaScript frameworks.','Ho guidato le decisioni tecniche e di design, sviluppando applicazioni di ricerca responsive con framework JavaScript moderni.')])
 c.showPage();page(2);txt(choose('EXPERIENCE & EXPERTISE','ESPERIENZA E COMPETENZE'),22,'Bold',after=15)
 role('ENDO-FAP DON ORIONE',choose('Lecturer, App Design & Development','Docente di design e sviluppo di applicazioni'),'2022 - 2023',[
 choose('Taught and mentored students in application design, development principles and mobile architecture.','Ho insegnato e affiancato gli studenti nel design di applicazioni, nei principi di sviluppo e nelle architetture mobile.')])
 role('IDEGAMI','Designer &amp; Software Engineer','2020 - 2023',[
 choose('Designed digital design systems and implemented applications, connecting visual consistency with reusable software structures.','Ho progettato design system e sviluppato applicazioni, unendo coerenza visiva e strutture software riutilizzabili.')])
 hi=[choose('Took broad ownership of the application project, combining front-end implementation with technical and design direction.','Ho assunto la responsabilità complessiva del progetto applicativo, unendo sviluppo front-end, direzione tecnica e design.'),choose('Coordinated company leadership and the external backend provider as technical lead for shared decisions and front-end/backend integration.','Ho coordinato direzione aziendale e fornitore backend esterno come referente tecnico per le decisioni condivise e l’integrazione tra front-end e backend.'),choose('Developed component architectures and micro-interactions as part of the product experience.','Ho sviluppato architetture a componenti e micro-interazioni per l’esperienza di prodotto.')]
 if key=='Product-Designer':hi=[hi[0],hi[2],hi[1]]
 role('HIBYE','Lead Software Engineer &amp; Designer','2017 - 2020',hi)
 role('ECRM ITALIA',choose('Designer / Developer','Designer / Sviluppatore'),'2015 - 2017',[
 choose('Designed and developed digital experiences, working across visual design and implementation.','Ho progettato e sviluppato esperienze digitali, curando design visivo e implementazione.')])
 section(choose('CORE EXPERTISE','COMPETENZE CHIAVE'))
 skills={
 'tech':choose('<b>Technical leadership</b> / Front-end architecture, hands-on delivery, technical decisions and coordination with backend partners and company leadership.','<b>Leadership tecnica</b> / Architettura front-end, sviluppo operativo, decisioni tecniche e coordinamento con partner backend e direzione aziendale.'),
 'ai':choose('<b>AI integration</b> / AI-enabled applications, prompt engineering and AI-assisted development, connecting model capabilities with product workflows.','<b>Integrazione AI</b> / Applicazioni basate su AI, prompt engineering e sviluppo assistito da AI, collegando le capacità dei modelli ai flussi di prodotto.'),
 'design':choose('<b>Product design</b> / Product concepts, design direction, interaction design, design systems, reusable components, prototyping and motion.','<b>Product design</b> / Concept di prodotto, direzione del design, interazioni, design system, componenti riutilizzabili, prototipazione e animazioni.')}
 orders={'Tech-Lead':['tech','design','ai'],'AI-Engineer':['ai','tech','design'],'Product-Designer':['design','tech','ai']}
 for s in orders[key]:txt(skills[s],10,after=7)
 txt('<b>'+choose('Tools and technologies','Strumenti e tecnologie')+'</b> / React, TypeScript, JavaScript, Vite, Figma, Codex.',9.7,after=7)
 section(choose('EDUCATION & PROFESSIONAL DEVELOPMENT','ISTRUZIONE E FORMAZIONE'))
 txt('<b>NAM Milano</b> / '+choose('Sound Design Specialist','Specialista in sound design')+'<br/><b>Infomedia Formazione</b> / Web Design<br/><b>Liceo Artistico Bruno Cassinari</b>',9.2,after=6)
 txt('<b>GOL 1: '+choose('Artificial Intelligence','Intelligenza Artificiale')+'</b> / IAL: Innovazione Apprendimento Lavoro<br/><b>JavaScript Essential Training</b> / Lynda / LinkedIn<br/><b>React Native &amp; Redux</b> / '+choose('Advanced Implementation','Implementazione avanzata'),9.2,after=0)
 c.save();r=PdfReader(dest);assert len(r.pages)==2
 full='\n'.join(x.extract_text() for x in r.pages);assert not any(n in full.lower() for n in ['otacon','ocelot'])
 assert r.pages[0].extract_text().index('MEI LING')<r.pages[0].extract_text().index('JOBRAPIDO')
 links=[str(a.get_object().get('/A',{}).get('/URI','')) for a in r.pages[0].get('/Annots',[])]
 for slug in ['meiling','grayfox']:assert 'https://francesco-saccullo-mediakit.web.app/'+slug+'/' in links
 print(dest.name,dest.stat().st_size,'bytes; 2 pages; demo links on page 1 verified')
 return dest

if __name__=='__main__':
 files=[build(k,l) for k in profiles for l in ['IT','EN']]
 with zipfile.ZipFile(OUT/'Francesco-Saccullo_CV_3-Roles_IT-EN.zip','w',zipfile.ZIP_DEFLATED) as z:
  for f in files:z.write(f,f.name)
