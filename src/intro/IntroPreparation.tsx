import styles from './IntroPreparation.module.css';

/** Lightweight first-paint feedback shared by every startup boundary. */
export default function IntroPreparation() {
  return <section className={styles.screen} role="status" aria-label="Preparing your visit">
    <span className={styles.brand}>motiondesign.ad</span>
  </section>;
}
