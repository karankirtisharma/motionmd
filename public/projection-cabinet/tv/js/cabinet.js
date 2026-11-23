'use strict';
const app=document.getElementById('app'), proof=new URLSearchParams(location.search).has('proof');
const {formats, industries, films}=catalog;
// Inline material variables are consumed inside external stylesheets. Resolve URLs against the document.
for (const key of Object.keys(images)) images[key] = new URL(images[key], document.baseURI).href;

const by=(arr, id)=>arr.find(x=>x.id===id);
const format=id=>by(formats, id).label, industry=id=>by(industries, id).label;
const esc=s=>String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const number=n=>String(n).padStart(2, '0');
const glyphs={
  arrow:'M4 12h15m-6-6 6 6-6 6',
  back:'M20 12H5m6-6-6 6 6 6',
  chev:'m9 5 7 7-7 7',
  down:'m5 9 7 7 7-7',
  search:'M20 20l-5-5 M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
  save:'M6 4h12v16l-6-4-6 4z',
  check:'m4 12 5 5L20 6',
  play:'M7 4v16l13-8z',
  pause:'M8 5v14m8-14v14',
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  plus:'M12 5v14m-7-7h14',
  exit:'M5 5l14 14M19 5 5 19',
  link:'M10 14l4-4m-7 3-2 2a3.5 3.5 0 0 0 5 5l3-3m-2-10 3-3a3.5 3.5 0 0 1 5 5l-2 2',
  download:'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4'
};
function icon(k){
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="'+(glyphs[k]||glyphs.arrow)+
    '"/></svg>'
}
function mark(){
  return '<span class="mark"><svg viewBox="0 0 34 26" aria-hidden="true"><path d="M0 23 10 3h6L6 23zm11 0L21 3h6L17 23zm11 0 8-16 4 8-4 8z"/></svg><span>motiondesign<span class="ad">.ad</span></span></span>'
}
function link(id, label, cls='glassbtn', ic=''){
  return '<a class="'+cls+'" href="#ui/'+id+'">'+label+(ic?icon(ic):'')+'</a>'
}
function cmd(key, label, cls='glassbtn', v=''){
  return '<button type="button" class="'+cls+'" data-cmd="'+key+'" data-value="'+esc(v)+'">'+label+
    '</button>'
}
function pic(key, alt='', cl=''){
  return '<img alt="'+esc(alt)+'" class="'+cl+'" src="'+images[key]+'" draggable="false">'
}
function hrefParent(id){
  return '<a href="#ui/'+id+'">'+esc(routes[id]?.name||'Work')+'</a>'
}
function crumb(ids){
  return '<nav class="crumb" aria-label="Breadcrumb">'+ids.map(hrefParent).join(icon('chev'))+'</nav>'
}
function stored(key, fallback){
  try{
    return JSON.parse(localStorage.getItem('md.glass.'+key))??fallback
  }catch{
    return fallback
  }
}
function put(key, v){
  if(exampleSession)return;
  try{
    localStorage.setItem('md.glass.'+key, JSON.stringify(v))
  }catch{}
}
const selected=[films[2], films[3], films[0], films[1], films[4]];
const initialHeroIndex = Math.max(0, selected.findIndex(film => film.id === catalog.defaultFilmId));
let shortlist=stored('saved', []);if(!Array.isArray(shortlist))shortlist=[];
let draft=stored('choices', {});if(!draft||typeof draft!=='object')draft={};
let exampleSession=null;
let person={name:'', email:'', note:''},heroPos=initialHeroIndex,activeStage='styleframe',processPos=0,compareFrames=false,splitValue=50,searchString='',activeRoute='',shareIDs=[],urlQuery='',returnKey='',clock=null,viewTime=0,playing=false,reelFrame=-1;
const formatCopy=[
'Introduce a product through one unmistakable reveal.', 'Turn a brand point of view into a short visual story.', 'Make a difficult idea easy to follow, one beat at a time.', 'Build a first frame that earns the next one.', 'Use material, light and scale to explain a product.', 'Choreograph interface changes around a real user action.', 'Give a visual identity a repeatable language of movement.', 'Set the energy of a live event before the first speaker.', 'Turn a sequence of numbers into a readable visual argument.', 'Set the mood through typography, rhythm and reveal.'
];
const indCopy=['Interface, workflow and the moment a product clicks.', 'Form, finish and tactile details of personal technology.', 'Scent, glass and the small details of a beauty ritual.', 'Silhouette, road presence and the engineering underneath.', 'Ingredient, texture and the first impression of flavour.'];
const subjects=['a software workflow', 'a personal technology product', 'a fragrance or beauty product', 'an automotive form', 'a food or beverage product'];
const filmVerbs=['opens on a material detail, then reveals', 'builds its visual story around', 'uses sequential visual cues to explain', 'uses a single high-contrast hook to introduce', 'moves between surface detail and the full form of', 'follows an interface interaction for', 'develops a repeatable motion motif for', 'builds a wide opening sequence around', 'uses charts and visual comparisons to explore', 'uses typographic contrast to introduce'];
const studioOffers=[
{
  id:'launch-film',
  name:'Launch film',
  format:'product-launch',
  art:'hero-automotive',
  line:'One product. One reveal.',
  desc:'Build the launch around a hero film, from the first reveal to the final product lockup.',
  deliver:['Hero film', 'Product look development', 'Launch cutdowns']
},
{
  id:'social-pack',
  name:'Social pack',
  format:'social-ads',
  art:'social-ads.beauty-fragrance',
  line:'One story, multiple cuts.',
  desc:'Translate one campaign idea into a family of short edits with a recognisable visual thread.',
  deliver:['Hook variations', 'Short-form edits', 'Format adaptations']
},
{
  id:'brand-motion',
  name:'Brand motion system',
  format:'motion-identity',
  art:'motion-identity.automotive',
  line:'A brand in motion.',
  desc:'Define how a brand enters, responds and resolves across typography, marks and transitions.',
  deliver:['Motion principles', 'Identity animations', 'Reusable transitions']
}
];
const services=[
{
  id:'direction',
  name:'Creative direction',
  format:'brand-film',
  art:'brand-film.beauty-fragrance',
  desc:'Define the point of view, art direction and story beats before production starts.'
},
{
  id:'design',
  name:'Design & illustration',
  format:'motion-identity',
  art:'motion-identity.food-beverage',
  desc:'Build the graphic language of a campaign through shape, type, colour and composition.'
},
{
  id:'animation',
  name:'2D motion',
  format:'explainer',
  art:'explainer.saas',
  desc:'Turn diagrams, typography and interface states into readable movement.'
},
{
  id:'cgi',
  name:'3D & product CGI',
  format:'cgi-product',
  art:'cgi-product.automotive',
  desc:'Control the camera, lighting and materials around a product story.'
},
{
  id:'edit',
  name:'Edit & finishing',
  format:'social-ads',
  art:'social-ads.food-beverage',
  desc:'Shape the pacing, sound and final delivery versions of a film.'
}
];
const processNames=['Discovery', 'Storyboard', 'Styleframes', 'Animatic', 'Animation', 'Finishing'];
const processNotes=['Define the audience, the product truth and the one idea the viewer should remember.', 'Sequence the reveal. Decide what each shot tells the viewer before choosing its finish.', 'Resolve the image language: materials, lighting, typography and composition.', 'Set the timing of cuts, holds and transitions against a guide track.', 'Build the final shot movement from the approved timing and visual direction.', 'Polish the colour, mix the sound and prepare the delivery versions.'];
const studyKeys=['storyboard', 'styleframe', 'animatic', 'final'],studyLabels=['Storyboard', 'Styleframe', 'Animatic', 'Final frame'];
const studyNotes=['A pencil value study fixes the silhouette and the negative space around the product.', 'The colour frame sets the relationship between material, light and background.', 'A neutral-value frame isolates composition and contrast before finishing.', 'The finished concept frame brings the lighting, surface and colour decisions together.'];
const steps=['format', 'industry', 'runtime', 'timeline', 'contact', 'review', 'ready'];
const stepTitles=['Choose a format', 'Choose an industry', 'Set a runtime', 'Set a timeline', 'Add project details', 'Review your brief', 'Your brief is ready'];
const stepDescs=['Choose the type of film you want to make.', 'Give the studio a starting point for subject matter and visual references.', 'Choose a target length for the primary edit.', 'Pick the delivery window that best fits the project.', 'Add a contact and a short description for the project file.', 'Check the scope and the references you want to carry forward.', 'Download the project file to share with your studio contact.'];
const choiceOptions={
  format:formats.map(v=>v.label),
  industry:industries.map(v=>v.label),
  runtime:['15 seconds', '30 seconds', '45 seconds', '60 seconds', '90 seconds', 'To be decided'],
  timeline:['2–3 weeks', '4–6 weeks', '7–10 weeks', 'Flexible']
};
const proofDraft={format:'Product Launch', industry:'Beauty & Fragrance', runtime:'45 seconds', timeline:'4–6 weeks'};
const registry=[],routes={};
function route(id, name, group, parent, kind, item, desc=''){
  const r={id, name, group, parent, kind, item, desc};
  routes[id]=r;
  registry.push(r)
}
route('home', 'Featured work', 'Discovery', '', 'home', null, 'Enter the collection through five featured launch concepts.');
route('work', 'Browse work', 'Discovery', 'home', 'work', null, 'Choose a film format, industry or the complete visual index.');
route('formats', 'Film formats', 'Discovery', 'work', 'formats');
route('industries', 'Industries', 'Discovery', 'work', 'industries');
route('index', 'All 50 films', 'Discovery', 'work', 'index');
route('search', 'Search the collection', 'Discovery', 'work', 'search');
route('reel', 'Launch sequence', 'Discovery', 'home', 'reel', null, 'Play a five-part moving artwork sequence.');
formats.forEach(x=>route('format/'+x.id, x.label, 'Format collections', 'formats', 'format', x));
industries.forEach(x=>route('industry/'+x.id, x.label, 'Industry collections', 'industries', 'industry', x));
films.forEach(f=>{
  route('film/'+f.slug, f.title, format(f.formatId)+' · films', 'format/'+f.formatId, 'film', f);
  route('view/'+f.slug, f.title+' · motion preview', format(f.formatId)+' · films', 'film/'+f.slug, 'view', f);
  if(f.formatId==='product-launch')route('study/'+f.slug, f.title+' · frame study', format(f.formatId)+' · films', 'film/'+f.slug, 'study', f)
});
route('studio', 'Studio', 'Studio', 'home', 'studio');
route('offers', 'Project packages', 'Studio', 'studio', 'offers');
studioOffers.forEach(o=>route('offer/'+o.id, o.name, 'Studio', 'offers', 'offer', o));
route('services', 'Capabilities', 'Studio', 'studio', 'services');
services.forEach(s=>route('service/'+s.id, s.name, 'Studio', 'services', 'service', s));
route('process', 'Production process', 'Studio', 'studio', 'process');
route('saved', 'My shortlist', 'Shortlist', 'home', 'saved');
route('shared', 'Shared shortlist', 'Shortlist', 'saved', 'shared');
steps.forEach((s, i)=>route('brief/'+s, stepTitles[i], 'Project brief', i?'brief/'+steps[i-1]:'home', 'brief', s));
route('unavailable', 'Film preview unavailable', 'Recovery', 'film/aurelle-launch-film', 'unavailable');
route('controls', 'Control Center', 'Discovery', 'home', 'controls');
Object.assign(window, {registry, routes});
const solution=(id)=>routes[id]||{id:"unknown", name:"Page unavailable", kind:"missing"};
function tile(to, key, title, meta=''){
  return '<a class="tile" href="#ui/'+to+'"><div class="tilepic">'+pic(key)+
    '</div><div class="tileinfo"><strong>'+esc(title)+
    '</strong><span>'+esc(meta)+
    '</span></div></a>'
}
function filmTile(f){
  return tile('film/'+f.slug, f.id, f.title, industry(f.industryId)+' / '+format(f.formatId))
}
function sect(k, title, side=''){
  return '<div class="sectionbar"><div class="leftlabel"><span class="eyebrow">'+k+'</span><h1>'+title+
    '</h1></div>'+side+
    '</div>'
}
function intro(k, title, desc, acts=''){
  return '<div class="intro"><span class="eyebrow">'+k+'</span><h1>'+title+'</h1><p class="desc">'+desc+
    '</p>'+(acts?'<div class="actions">'+acts+'</div>':'')+
    '</div>'
}
const duration=f=>f.durationSeconds?Math.floor(f.durationSeconds/60)+':'+number(f.durationSeconds%60):'Open';
const fidx=f=>formats.findIndex(x=>x.id===f.formatId), iidx=f=>industries.findIndex(x=>x.id===f.industryId);
function work(){
  return '<section class="inner">'+crumb(['home'])+'<div class="split">'+intro('Work / Portfolio', 'Find your<br><em>reference.</em>', 'Explore fifty film concepts by what they do or by the industry they serve.', link('index', 'All 50 films', 'act', 'grid')+link('search', 'Search', 'glassbtn', 'search'))+
    '<div class="collection"><div class="samplehead"><b>Explore the collection</b><span>10 formats · 5 industries</span></div><div class="tilegrid three featurecards">'+tile('formats', 'motion-identity.automotive', 'Film formats', 'Browse ten types of motion work')+tile('industries', 'hero-beauty-fragrance', 'Industries', 'Explore five visual worlds')+tile('index', 'explainer.food-beverage', 'Visual index', 'Every film in one view')+
    '</div></div></div></section>'
}
function directory(r){
  const fm=r.kind==='formats',arr=fm?formats:industries;
  return '<section class="inner directory '+(fm?'':'industries')+'">'+crumb(['home', 'work'])+sect('Browse work', fm?'Film <em>formats.</em>':'Five <em>industries.</em>', '<p>'+(fm?'Five industry concepts in every format.':'Ten film formats in every industry.')+'</p>')+
    '<div class="tilegrid">'+arr.map((o, i)=>tile((fm?'format/':'industry/')+o.id, fm?films[i*5+([2, 3, 0, 4, 1][i%5])].id:'hero-'+o.id, o.label, fm?'5 concepts':'10 concepts')).join('')+
    '</div></section>';
}
function collection(r){
  const fm=r.kind==='format',o=r.item,list=films.filter(f=>(fm?f.formatId:f.industryId)===o.id);
  return '<section class="inner">'+crumb(['home', 'work', fm?'formats':'industries'])+'<div class="split">'+intro(fm?'Film format':'Industry collection', esc(o.label)+'<em>.</em>', (fm?formatCopy:indCopy)[(fm?formats:industries).findIndex(v=>v.id===o.id)], link(fm?'formats':'industries', fm?'All formats':'All industries', 'glassbtn', 'grid'))+
    '<div class="collection"><div class="samplehead"><b>Concept selection</b><span>'+list.length+
    ' films</span></div><div class="tilegrid '+(fm?'featurecards':'')+'">'+list.map(filmTile).join('')+
    '</div></div></div></section>';
}
function matrix(){
  return '<section class="inner">'+crumb(['home', 'work'])+sect('Visual index', 'All <em>50</em> films.', '<p>Pick a frame where format and industry meet.</p>')+
    '<div class="matrixwrap"><table class="matrix"><thead><tr><th>Industry / Format</th>'+formats.map(f=>'<th scope="col">'+link('format/'+f.id, esc(f.label), '')+'</th>').join('')+
    '</tr></thead><tbody>'+industries.map(i=>'<tr><th scope="row">'+link('industry/'+i.id, esc(i.label), '')+'</th>'+formats.map(f=>{
    const x=films.find(v=>v.formatId===f.id&&v.industryId===i.id);
    return '<td><a class="mcell" aria-label="'+esc(x.title)+'" title="'+esc(x.title)+'" href="#ui/film/'+x.slug+'">'+pic(x.id)+
      '<span>'+number(films.indexOf(x)+1)+
      '</span></a></td>'
  }).join('')+
    '</tr>').join('')+
    '</tbody></table></div></section>'
}
function saveButton(f){
  const saved=shortlist.includes(f.slug);
  return '<button class="glassbtn" data-cmd="save" data-value="'+f.slug+'" aria-pressed="'+saved+'">'+icon(saved?'check':'save')+(saved?'Saved':'Save')+
    '</button>'
}
function player(r){
  const reel=r.kind==='reel',f=reel?selected[0]:r.item;
  return '<section class="player"><div class="playart">'+pic(reel?'hero-'+f.industryId:f.id)+
    '</div><div class="playtop">'+link(reel?'home':'film/'+f.slug, icon('back')+' '+(reel?'Featured work':'Film overview'), 'glassbtn')+
    '<span class="tagline">'+(reel?'Five launch concepts':'Animated artwork')+
    '</span></div><div><span class="smallcap" id="playlabel">'+(reel?'01 / 05 · '+esc(f.title):esc(format(f.formatId))+' / Motion preview')+
    '</span><h1>'+esc(reel?'Launch sequence':f.title)+
    '</h1><div class="transport glass">'+cmd('play', '<span class="sr">Play preview</span>'+icon('play'), 'sq')+
    '<span class="time" id="elapsed">0:00</span><input id="seek" aria-label="Preview timeline" type="range" value="0" min="0" max="'+(reel?20:6)+
    '" step=".01"><span class="time">'+(reel?'0:20':'0:06')+
    '</span></div></div></section>';
}
function study(r){
  const f=r.item,n=studyKeys.indexOf(activeStage);
  const comparing=compareFrames&&n!==0;
  const overlay=comparing?'<div class="wipe" style="--split:'+splitValue+'%">'+pic(f.industryId+'-storyboard', 'Storyboard comparison')+
    '<i></i></div><input type="range" class="wipe-range" min="0" max="100" aria-label="Storyboard reveal percentage" value="'+splitValue+
    '"><span class="comparelabel">Storyboard / '+studyLabels[n]+
    '</span>':'';
  return '<section class="inner">'+crumb(['work', 'film/'+f.slug])+'<div class="split">'+intro('Production frames', esc(f.title.replace(/ Launch Film/i, ''))+'<br><em>frame study.</em>', studyNotes[n], link('film/'+f.slug, 'Film overview', 'glassbtn', 'back'))+
    '<div class="collection"><div class="samplehead"><b>'+studyLabels[n]+
    '</b><span>Frame '+number(n+1)+
    ' / 04</span></div><div class="studyimg">'+pic(f.industryId+'-'+activeStage, studyLabels[n]+' for '+f.title)+overlay+
    '</div><div class="frameTabs">'+studyKeys.map((k, i)=>cmd('stage', studyLabels[i], 'chip'+(k===activeStage?' on':''), k)).join('')+(n?cmd('compare', comparing?'Close comparison':'Compare frames', 'chip'+(comparing?' on':'')):'')+
    '</div></div></div></section>'
}
function searchResults(q){
  const words=q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list=films.filter(f=>words.every(w=>(f.title+' '+format(f.formatId)+' '+industry(f.industryId)).toLowerCase().includes(w)));
  const show=words.length?list:selected;
  return {
    count:words.length?list.length+' matching concept'+(list.length===1?'':'s'):'Featured concepts',
    html:show.length?'<div class="tilegrid">'+show.map(filmTile).join('')+'</div>':'<div class="empty"><h2>No matching films.</h2><p>Try a format such as CGI, or an industry such as automotive.</p>'+cmd('clear-search', 'Clear search', 'glassbtn')+
      '</div>'
  };
}
function libraryPage(r){
  const shared=r.kind==='shared',ids=shared?shareIDs:shortlist,list=ids.map(s=>films.find(f=>f.slug===s)).filter(Boolean);
  const items=list.length?'<div class="tilegrid">'+list.map(filmTile).join('')+'</div>':'<div class="empty"><h2>'+(shared?'No references in this link.':'Your shortlist is empty.')+
    '</h2><p>'+(shared?'Open a shared selection or explore the collection.':'Use Save on any film to collect it here.')+
    '</p>'+link('work', 'Browse work', 'glassbtn', 'arrow')+
    '</div>';
  const extra=shared?cmd('import', icon('plus')+' Add to my shortlist', 'glassbtn'):cmd('share', icon('link')+' Share selection', 'glassbtn');
  return '<section class="inner">'+crumb(shared?['home', 'saved']:['home'])+sect(shared?'References / Shared':'References / Saved', shared?'Shared <em>shortlist.</em>':'My <em>shortlist.</em>', '<span class="smallcap">'+list.length+' references</span>')+
    '<div class="resultzone">'+items+
    '</div>'+(list.length?'<div class="actions">'+extra+(shared?'':link('brief/format', 'Take into a brief', 'act', 'arrow'))+
    '</div>':'')+
    '</section>';
}
function studio(){
  return '<section class="inner">'+crumb(['home'])+'<div class="split">'+intro('MotionDesign.ad / Studio', 'Motion,<br><em>by design.</em>', 'Explore how the studio turns product stories into films, campaign edits and motion identities.', link('brief/format', 'Start a brief', 'act', 'arrow'))+
    '<div class="collection"><div class="samplehead"><b>Explore the studio</b></div><div class="tilegrid three featurecards">'+tile('offers', 'hero-beauty-fragrance', 'Project packages', 'Choose a project shape')+tile('services', 'cgi-product.automotive', 'Capabilities', 'Explore five disciplines')+tile('process', 'beauty-fragrance-storyboard', 'Production process', 'Follow the six stages')+
    '</div></div></div></section>'
}
function studioDir(r){
  const offers=r.kind==='offers',arr=offers?studioOffers:services;
  return '<section class="inner directory industries">'+crumb(['home', 'studio'])+sect('Studio / '+(offers?'Engagements':'Disciplines'), offers?'Project <em>packages.</em>':'Studio <em>capabilities.</em>', '<p>'+(offers?'Choose a starting scope for a project.':'Explore what goes into the finished film.')+
    '</p>')+
    '<div class="tilegrid '+(offers?'three':'')+'">'+arr.map((o, i)=>tile((offers?'offer/':'service/')+o.id, o.art, o.name, offers?o.line:format(o.format)+' references')).join('')+
    '</div></section>';
}
function studioDetail(r){
  const o=r.item,offer=r.kind==='offer';
  return '<section class="film"><div class="filmtext">'+crumb(['studio', offer?'offers':'services'])+
    '<span class="tagline">'+(offer?'Project package':'Studio capability')+
    '</span><h1>'+esc(o.name)+
    '<em>.</em></h1><p class="desc">'+esc(o.desc)+
    '</p>'+(offer?'<div class="pills">'+o.deliver.map(i=>'<span class="chip">'+esc(i)+'</span>').join('')+'</div>':'')+
    '<div class="actions">'+cmd('seed-brief', 'Start a brief '+icon('arrow'), 'act', o.format)+link('format/'+o.format, 'See related work', 'glassbtn', 'arrow')+
    '</div></div><div class="filmvisual">'+pic(o.art)+
    '<span class="artcaption">'+esc(format(o.format))+
    ' / Concept reference</span></div></section>';
}
function processPage(){
  const f=selected[0],keys=['hero-beauty-fragrance', 'beauty-fragrance-storyboard', 'beauty-fragrance-styleframe', 'beauty-fragrance-animatic', 'beauty-fragrance-final', 'product-launch.beauty-fragrance'];
  return '<section class="inner">'+crumb(['home', 'studio'])+'<div class="split">'+intro('Studio / Method', 'Production<br><em>process.</em>', 'Follow a fragrance concept from the initial brief to the finishing pass.', link('study/'+f.slug, 'Explore its frames', 'glassbtn', 'arrow'))+
    '<div class="processboard"><div class="steps">'+processNames.map((s, i)=>cmd('process', '<i>'+number(i+1)+'</i><b>'+s+'</b>', 'step'+(i===processPos?' active':''), i)).join('')+
    '</div><div>'+pic(keys[processPos], processNames[processPos]+' visual reference')+
    '<h2>'+processNames[processPos]+
    '</h2><p class="bodytext">'+processNotes[processPos]+
    '</p></div></div></div></section>';
}
function brief(r){
  const s=r.item,n=steps.indexOf(s),d=Object.assign({}, proof?proofDraft:{}, draft);
  const p=proof?{name:'Sample producer', email:'producer@example.com', note:'A material-led fragrance reveal.'}:person;
  const savedFilm=films.find(f=>shortlist.includes(f.slug)), related=films.find(f=>industry(f.industryId)===d.industry&&format(f.formatId)===d.format)||savedFilm;
  const summary=[['Format', d.format], ['Industry', d.industry], ['Runtime', d.runtime], ['Timeline', d.timeline], ['Contact', p.name], ['Email', p.email], ['Project notes', p.note], ['Saved references', shortlist.length]];
  const back=n>0&&n<6?link('brief/'+steps[n-1], icon('back')+' Back', 'glassbtn'):'';
  let action='',body='';
  if(n<4){
    body='<div class="choicegrid" role="group" aria-label="'+stepTitles[n]+'">'+choiceOptions[s].map(o=>'<button aria-pressed="'+(d[s]===o)+'" class="choice '+(d[s]===o?'on':'')+'" data-cmd="choose" data-value="'+esc(o)+'">'+esc(o)+
      '<i class="circlemark" aria-hidden="true"></i></button>').join('')+
      '</div>';
    action=cmd('next', 'Continue '+icon('arrow'), 'act')
  }
  if(n===4){
    body='<div class="fields">'+[['name', 'Your name', 'text'], ['email', 'Email address', 'email'], ['note', 'What should the film communicate?', 'textarea']].map(([k, label, t])=>'<div class="field"><label for="field-'+k+'">'+label+(k==='note'?' (optional)':'')+'</label>'+(t==='textarea'?'<textarea id="field-'+k+'" data-field="'+k+'" rows="2" maxlength="1200">'+esc(p[k])+'</textarea>':'<input id="field-'+k+'" data-field="'+k+'" type="'+t+'" maxlength="200" required value="'+esc(p[k])+'">')+
      '</div>').join('')+
      '</div>';
    action=cmd('next', 'Review brief '+icon('arrow'), 'act')
  }
  if(n===5){
    body='<dl class="reviewlist">'+summary.map(([k, v])=>'<div><dt>'+k+'</dt><dd>'+esc(v===0?'0':v||'—')+'</dd></div>').join('')+
      '</dl>';
    action=cmd('next', 'Prepare project file '+icon('arrow'), 'act')
  }
  if(n===6){
    body='<div class="briefready"><span class="eyebrow">Project file / Markdown</span><h2 class="subhead">Project <em>brief.</em></h2><p class="bodytext">'+esc(d.format||'Project scope')+(d.industry?' · '+esc(d.industry):'')+
      '</p></div>';
    action=cmd('download', 'Download brief '+icon('download'), 'act')+link('brief/review', 'Edit details', 'glassbtn')
  }
  const progress='<div class="lineprogress" aria-label="Step '+Math.min(n+1, 6)+' of 6">'+steps.slice(0, 6).map((q, i)=>'<i class="'+(i<=n?'on':'')+'"></i>').join('')+
    '</div>';
  return '<section class="inner">'+crumb(['home'])+'<div class="wizard">'+intro(n===6?'Project brief / Prepared':'Project brief / Step '+number(n+1)+' of 06', stepTitles[n]+'<em>.</em>', stepDescs[n], progress)+
    '<div class="formbody">'+body+
    '<p id="brief-error" class="error" role="alert"></p><div class="actions">'+back+action+
    '</div></div><aside class="briefplate">'+pic(related?related.id:'motion-identity.beauty-fragrance')+
    '<span class="smallcap">Project scope</span><h2>'+esc(d.format||'New project')+
    '</h2><p>'+esc([d.industry, d.runtime, d.timeline].filter(Boolean).join(' / ')||'Your choices will appear here.')+
    '</p><p>'+shortlist.length+' saved reference'+(shortlist.length===1?'':'s')+
    '</p></aside></div></section>';
}
function missing(){
  return '<section class="inner"><div class="split">'+intro('Navigation', 'Page <em>unavailable.</em>', 'This address does not match a page in the portfolio.', link('work', 'Browse work', 'act', 'arrow')+link('home', 'Featured work', 'glassbtn'))+
    '<div class="studyimg">'+pic('motion-identity.beauty-fragrance')+
    '</div></div></section>'
}
function content(r){
  switch(r.kind){
    case 'controls':return controlPage();
    case 'unavailable':return unavailable();
    case 'home':return home();
    case 'work':return work();
    case 'formats':
    case 'industries':return directory(r);
    case 'format':
    case 'industry':return collection(r);
    case 'index':return matrix();
    case 'film':return film(r);
    case 'view':
    case 'reel':return player(r);
    case 'study':return study(r);
    case 'studio':return studio();
    case 'services':
    case 'offers':return studioDir(r);
    case 'offer':
    case 'service':return studioDetail(r);
    case 'process':return processPage();
    case 'search':return searchPage();
    case 'saved':
    case 'shared':return libraryPage(r);
    case 'brief':return brief(r);
    default:return missing();}
}
const reduce=()=>proof||settings.motion||settings.lite||matchMedia('(prefers-reduced-motion: reduce)').matches;
function toast(s){
  const n=document.getElementById('notice');
  n.textContent=s;
  n.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>n.classList.remove('on'), 2300)
}
function stopClock(){
  if(clock!==null)cancelAnimationFrame(clock);
  clock=null;
  playing=false
}
function drawPlayer(){
  const r=solution(activeRoute),reel=r.kind==='reel',i=Math.min(4, Math.floor(viewTime/4)),art=app.querySelector('.playart img');
  if(!art)return;
  if(reel&&reelFrame!==i){
    const f=selected[i];
    art.src=images['hero-'+f.industryId];
    app.querySelector('#playlabel').textContent=number(i+1)+' / 05 · '+f.title;
    reelFrame=i
  }
  if(!reduce()){
    const pct=reel?(viewTime%4)/4:viewTime/6;
    art.style.transform='scale('+(1+pct*.075)+') translateX('+(-pct*.65)+'%)'
  }
  app.querySelector('#elapsed').textContent='0:'+number(Math.floor(viewTime));
  app.querySelector('#seek').value=viewTime;
  const b=app.querySelector('[data-cmd="play"]');
  b.setAttribute('aria-label', playing?'Pause preview':'Play preview');
  b.innerHTML=icon(playing?'pause':'play');
  window.FX?.playhead(viewTime, reel?20:6, playing, reel);
}
function togglePlay(){
  const total=activeRoute==='reel'?20:6;
  if(playing){
    stopClock();
    drawPlayer();
    return
  }
  if(viewTime>=total)viewTime=0;
  playing=true;
  let last=performance.now();
  function tick(now){
    if(!playing)return;
    viewTime=Math.min(total, viewTime+(now-last)/1000);
    last=now;
    if(viewTime>=total)stopClock();
    drawPlayer();
    if(playing)clock=requestAnimationFrame(tick)
  }
  clock=requestAnimationFrame(tick);
  drawPlayer()
}
function view(r){
  document.title=r.name+' — MotionDesign.ad';
  const ui='<div data-kind="'+r.kind+'" class="ui '+(r.kind==='brief'?'light':'')+'">'+head(r)+content(r)+'</div>';
  // The motion layer (js/fx) keeps the shell alive and swaps content in place. Without it, render as before.
  if(!window.FX?.swap(r, ui)){
    app.innerHTML='<main id="content" tabindex="-1" class="liveframe"><div class="stage" style="--satin:url('+images.satin+');--stone:url('+images.marble+');--grain:url('+images['walnut']+');--paper:url('+images['ivory-calcite']+
      ')">'+ui+'</div></main>';
    if(!window.FX&&!document.documentElement.classList.contains('fx-boot')&&!reduce()&&window.gsap){
      gsap.fromTo(app.querySelectorAll('.feature-main,.intro,.filmtext,.sectionbar,.formbody,.playtop'), {y:7, opacity:.55}, {y:0, opacity:1, duration:.4, ease:'power2.out', clearProps:'transform,opacity'});
      gsap.fromTo(app.querySelectorAll('.tile'), {y:6, opacity:.7}, {y:0, opacity:1, duration:.32, stagger:.017, ease:'power2.out', clearProps:'transform,opacity'})
    }
  }
  if(r.kind==='view' && approvedSource(r.item)) mountFilm(r.item);
 else if(r.kind==='reel'||r.kind==='view')drawPlayer();
  if(r.kind==='brief' && r.item==='ready') mountSubmission();
  window.dispatchEvent(new CustomEvent('cabinet:view', {detail:{id:r.id, kind:r.kind}}));
}
function render(){
  const key=location.hash.slice(1)||'ui/home';
  const zoom=document.getElementById('zoom');
  if(zoom.open)zoom.close();
  if(key.startsWith('ui/controls')&&['reel', 'view'].includes(solution(activeRoute).kind)){
    suspendedPreview={id:activeRoute, time:app.querySelector('video')?.currentTime??viewTime}
  }
  const restoreTime=activeRoute==='controls'&&suspendedPreview?.id===key.slice(3).split('?')[0]?suspendedPreview.time:0;
  stopClock();
  viewTime=restoreTime;
  reelFrame=-1;
  if(!key.startsWith('ui/')){
    if(exampleSession){
      ({shortlist, draft, person}=exampleSession);
      exampleSession=null
    }
    activeRoute='';
    location.replace(location.href.split('#')[0]+'#ui/home');
    return
  }
  const path=key.slice(3).split('?')[0],detail=new URLSearchParams(key.includes('?')?key.split('?')[1]:'');
  const r=solution(path);
  if(r.kind==='controls'&&activeRoute&&activeRoute!=='controls')controlFrom=activeRoute;
  const sample=detail.get('sample')==='1';
  if(sample&&!exampleSession){
    exampleSession={shortlist, draft, person};
    shortlist=r.kind==='search'?[]:[selected[0].slug, selected[1].slug, selected[3].slug];
    draft={...proofDraft};
    person={name:'Sample producer', email:'producer@example.com', note:'A material-led fragrance reveal.'}
  }
  if(r.kind==='brief'&&r.item==='ready'&&!proof&&(!steps.slice(0, 4).every(k=>draft[k])||!person.email||!person.name)){
    location.replace(location.href.split('#')[0]+'#ui/brief/review');
    return
  }
  if(activeRoute!==r.id){
    activeStage=r.id==='study/kairo-launch-film'?'animatic':'styleframe';
    compareFrames=false;
    splitValue=50;
    processPos=0;
    searchString='';
    if(r.kind==='home')heroPos=initialHeroIndex
  }
  activeRoute=r.id;
  shareIDs=r.kind==='shared'?[...new Set((detail.get('films')||'').split(',').filter(slug=>films.some(f=>f.slug===slug)))]:[];
  if(sample&&r.kind==='search')searchString='perfume';
  if(proof){
    shortlist=(r.kind==='saved'||r.kind==='brief')?[selected[0].slug, selected[1].slug, selected[3].slug]:[];
    if(r.kind==='shared')shareIDs=referenceList();
    if(r.kind==='search')searchString='perfume'
  }
  view(r);
  window.scrollTo(0, 0);
  if(!proof){
    document.getElementById('content').focus({preventScroll:true})
  }
}
function refresh(focus){
  view(solution(activeRoute));
  if(focus){
    const el=app.querySelector(focus);
    if(el)el.focus({preventScroll:true})
  }
}
function stepError(message){
  document.getElementById('brief-error').textContent=message
}
function next(){
  const n=steps.indexOf(solution(activeRoute).item);
  if(n<4&&!draft[steps[n]]){
    stepError('Choose an option to continue.');
    return
  }
  if(n===4){
    if(!person.name.trim()){
      stepError('Enter a name for this brief.');
      document.getElementById('field-name').focus();
      return
    }
    const email=document.getElementById('field-email');
    if(!email.value||!email.validity.valid){
      stepError('Enter a valid email address.');
      email.focus();
      return
    }
  }
  if(n===5){
    const missingKey=steps.slice(0, 4).find(k=>!draft[k]);
    if(missingKey){
      location.hash='ui/brief/'+missingKey;
      toast('Complete the remaining scope details.');
      return
    }
    if(!person.name.trim()||!person.email.trim()){
      location.hash='ui/brief/contact';
      toast('Add contact details before preparing the brief.');
      return
    }
  }
  location.hash='ui/brief/'+steps[n+1];
}
function exportBrief(){
  if(steps.slice(0, 4).some(k=>!draft[k])||!person.name.trim()||!person.email.trim()){
    location.hash='ui/brief/review';
    toast('Complete the brief before downloading.');
    return
  }
  const lines=['# MotionDesign.ad project brief', '', ...steps.slice(0, 4).map(k=>k[0].toUpperCase()+k.slice(1)+' — '+draft[k]), '', 'Contact — '+person.name, 'Email — '+person.email, '', 'Project notes', person.note||'—', '', 'Selected references', ...shortlist.map(s=>films.find(f=>f.slug===s)?.title||'').filter(Boolean)];
  const url=URL.createObjectURL(new Blob([lines.join('\n')], {type:'text/markdown;charset=utf-8'}));
  const a=document.createElement('a');
  a.href=url;
  a.download='MotionDesign_Project_Brief.md';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 6000);
  toast('Project file prepared.')
}
function addHandlers(){
  app.addEventListener('click', async e=>{
    const b=e.target.closest('[data-cmd]');
    if(!b)return;
    const c=b.dataset.cmd,v=b.dataset.value||'',r=solution(activeRoute);
    if(c==='hero'){
      heroPos=Number(v);
      refresh('[data-cmd="hero"][data-value="'+v+'"]')
    }
 else if(c==='save'){
      shortlist=shortlist.includes(v)?shortlist.filter(x=>x!==v):[...shortlist, v];
      put('saved', shortlist);
      refresh('[data-cmd="save"]');
      toast(shortlist.includes(v)?'Added to shortlist':'Removed from shortlist')
    }
 else if(c==='stage'){
      activeStage=v;
      refresh('[data-cmd="stage"][data-value="'+v+'"]')
    }
 else if(c==='compare'){
      compareFrames=!compareFrames;
      refresh('[data-cmd="compare"]')
    }
 else if(c==='process'){
      processPos=Number(v);
      refresh('[data-cmd="process"][data-value="'+v+'"]')
    }
 else if(c==='play')togglePlay();
 else if(c==='clear-search'){
      searchString='';
      refresh('#filmsearch')
    }
 else if(c==='import'){
      shortlist=[...new Set([...shortlist, ...shareIDs])];
      put('saved', shortlist);
      location.hash='ui/saved'
    }
 else if(c==='share'){
      const hash='ui/shared?films='+shortlist.join(',');
      location.hash=hash;
      try{
        if(location.protocol==='https:'&&navigator.clipboard){
          await navigator.clipboard.writeText(location.href.split('#')[0]+'#'+hash);
          toast('Share link copied')
        }else{
          toast('Shared selection opened. Use its address with this HTML file.')
        }
      }catch{
        toast('Shared selection opened.')
      }
    }
 else if(c==='seed-brief'){
      draft.format=format(v);
      put('choices', draft);
      location.hash='ui/brief/format'
    }
 else if(c==='choose'){
      draft[r.item]=v;
      put('choices', draft);
      view(r);
      Array.from(app.querySelectorAll('[data-cmd="choose"]')).find(x=>x.dataset.value===v)?.focus({preventScroll:true})
    }
 else if(c==='next')next();else if(c==='download')exportBrief();
  });
  app.addEventListener('input', e=>{
    if(e.target.classList.contains('wipe-range')){
      splitValue=Number(e.target.value);
      app.querySelector('.wipe').style.setProperty('--split', splitValue+'%')
    }else if(e.target.id==='filmsearch'){
      searchString=e.target.value;
      const res=searchResults(searchString);
      app.querySelector('#results').innerHTML=res.html;
      app.querySelector('#matchcount').textContent=res.count
    }else if(e.target.id==='seek'){
      viewTime=Number(e.target.value);
      drawPlayer()
    }else if(e.target.dataset.field)person[e.target.dataset.field]=e.target.value
  });
  app.addEventListener('pointermove', e=>{
    if(reduce())return;
    const el=e.target.closest('.glassbtn,.glass,.sq');
    if(!el)return;
    const box=el.getBoundingClientRect();
    el.style.setProperty('--mx', ((e.clientX-box.left)/box.width*100)+'%')
  });
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'&&activeRoute&&!document.getElementById('zoom').open){
      const r=solution(activeRoute);
      if(['view', 'study'].includes(r.kind))location.hash='ui/'+r.parent;else if(r.kind==='controls')location.hash='ui/'+controlFrom;else location.hash='ui/'+(r.parent||'home')
    }
  });
  if(window.gsap){
    const target=e=>e.target.closest('.tile,.glassbtn,.act,.sq');
    const reset=el=>{
      gsap.to(el, {
        rotationX:0,
        rotationY:0,
        scale:1,
        duration:.3,
        ease:'power2.out',
        overwrite:'auto',
        clearProps:'transform'
      });
      el.style.removeProperty('--pointer-x');
      el.style.removeProperty('--pointer-y');
      el.classList.remove('reflect')
    };
    // With the motion layer loaded, js/fx/motion.js owns hover tilt and press transforms.
    app.addEventListener('pointermove', e=>{
      if(window.FX||!activeRoute||reduce()||e.pointerType!=='mouse')return;
      const el=target(e);
      if(!el)return;
      const b=el.getBoundingClientRect(),x=(e.clientX-b.left)/b.width-.5,y=(e.clientY-b.top)/b.height-.5;
      el.style.setProperty('--pointer-x', (50+x*100)+'%');
      el.style.setProperty('--pointer-y', (50+y*100)+'%');
      el.classList.add('reflect');
      gsap.to(el, {
        transformPerspective:800,
        rotationX:-y*3,
        rotationY:x*4,
        duration:.24,
        ease:'power2.out',
        overwrite:'auto'
      })
    });
    app.addEventListener('pointerout', e=>{
      if(window.FX||!activeRoute||reduce())return;
      const el=target(e);
      if(el&&!el.contains(e.relatedTarget))reset(el)
    });
    app.addEventListener('pointerdown', e=>{
      if(window.FX||!activeRoute||reduce())return;
      const el=target(e);
      if(el)gsap.to(el, {scale:.985, duration:.1, overwrite:'auto'})
    });
    app.addEventListener('pointerup', e=>{
      if(window.FX||!activeRoute||reduce())return;
      const el=target(e);
      if(el)gsap.to(el, {scale:1, duration:.27, ease:'power2.out', overwrite:'auto'})
    });
  }
  window.addEventListener('hashchange', render);
}
